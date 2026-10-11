import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({ ip: "203.0.113.10", locale: "fr" as "fr" | "en", admin: true }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": `${request.ip}, 10.0.0.1` }) }));
vi.mock("@/i18n/server", () => ({ getLocale: async () => request.locale }));
vi.mock("@/lib/page-auth", () => ({
  requireAdmin: vi.fn(async () => {
    if (!request.admin) throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
    return { userId: "admin-user" };
  }),
}));
vi.mock("@/lib/env", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/env")>();
  return { ...original, env: { ...original.env, API_KEY_PEPPER: "integration-pepper-".padEnd(32, "0") } };
});

import { databasePool, requireDb } from "@/db/runtime";
import { auditEvents, betaApplications } from "@/db/schema";
import { markBetaApplicationReviewedAction } from "@/features/applications/admin-actions";
import { listBetaApplications } from "@/features/applications/admin";
import { submitBetaApplicationAction } from "@/features/applications/actions";
import { betaApplicationLimits } from "@/features/applications/store";
import { initialActionState } from "@/lib/action-state";
import { hmac } from "@/lib/crypto";

const db = requireDb();
const email = "Camille.Martin@Example.test";

function form(overrides: Record<string, string | undefined> = {}) {
  const data = new FormData();
  const fields: Record<string, string | undefined> = {
    company: "Atelier Martin",
    contactName: "Camille Martin",
    workEmail: email,
    websiteUrl: "https://atelier.example.test",
    useCase: "Reçus de paiement et réinitialisation de mot de passe.",
    expectedMonthlyVolume: "12 000",
    consent: "on",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) data.set(key, value);
  return data;
}

const submit = (data = form()) => submitBetaApplicationAction(initialActionState(), data);

beforeEach(async () => {
  // Test database only: the global cap counts every recent application.
  await db.delete(betaApplications);
  request.ip = "203.0.113.10";
  request.locale = "fr";
  request.admin = true;
});
afterAll(async () => {
  await db.delete(betaApplications);
  await databasePool!.end();
});

describe("public beta application form", () => {
  it("stores a valid application with a keyed IP hash and never logs the email", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    try {
      const state = await submit();
      expect(state).toMatchObject({ ok: true, message: expect.stringContaining("bien reçue") });
      const [row] = await db.select().from(betaApplications);
      expect(row).toMatchObject({
        company: "Atelier Martin",
        workEmail: "camille.martin@example.test",
        expectedMonthlyVolume: 12_000,
        locale: "fr",
        status: "new",
        ipHash: hmac("beta-application-ip:203.0.113.10", "integration-pepper-".padEnd(32, "0")),
      });
      expect(row.ipHash).not.toContain("203.0.113.10");
      expect(row.consentedAt).toBeInstanceOf(Date);
      for (const spy of logs) expect(JSON.stringify(spy.mock.calls).toLowerCase()).not.toContain("camille.martin");
    } finally {
      for (const spy of logs) spy.mockRestore();
    }
  });

  it("returns localized field errors, keeps what was typed and stores nothing", async () => {
    request.locale = "en";
    const state = await submit(form({ workEmail: "not-an-email", useCase: "short", expectedMonthlyVolume: "-4", consent: undefined, websiteUrl: "example" }));
    expect(state.ok).toBe(false);
    expect(Object.keys(state.fieldErrors).sort()).toEqual(["consent", "expectedMonthlyVolume", "useCase", "websiteUrl", "workEmail"]);
    expect(state.fieldErrors.workEmail).toEqual(["Enter a valid work email address."]);
    expect(state.values).toMatchObject({ company: "Atelier Martin", workEmail: "not-an-email", useCase: "short" });
    expect(await db.select().from(betaApplications)).toHaveLength(0);
  });

  it("accepts an empty website and answers a filled honeypot like a success without storing it", async () => {
    expect(await submit(form({ websiteUrl: "" }))).toMatchObject({ ok: true });
    expect((await db.select().from(betaApplications))[0].websiteUrl).toBeNull();
    await db.delete(betaApplications);
    expect(await submit(form({ faxNumber: "+33 1 23 45 67 89" }))).toMatchObject({ ok: true });
    expect(await db.select().from(betaApplications)).toHaveLength(0);
  });

  it("limits submissions per hashed IP and globally, with the contact address as fallback", async () => {
    for (let index = 0; index < betaApplicationLimits.perIp; index++) expect((await submit()).ok).toBe(true);
    const limited = await submit();
    expect(limited).toMatchObject({ ok: false, message: expect.stringContaining("hello@yodev.fr") });
    expect(limited.values.company).toBe("Atelier Martin");
    request.ip = "198.51.100.7";
    expect((await submit()).ok).toBe(true);

    await db.insert(betaApplications).values(Array.from({ length: betaApplicationLimits.global }, (_, index) => ({
      company: `Bulk ${index}`, contactName: "Bulk", workEmail: `bulk${index}@example.test`, useCase: "Bulk fixture use case",
      expectedMonthlyVolume: 1, consentedAt: new Date(), ipHash: randomUUID().replaceAll("-", ""),
    })));
    request.ip = "192.0.2.44";
    expect((await submit()).ok).toBe(false);
    // Outside the window the counters no longer apply.
    await db.update(betaApplications).set({ createdAt: new Date(Date.now() - betaApplicationLimits.windowMs - 1000) });
    expect((await submit()).ok).toBe(true);
  });

  it("serializes concurrent submissions from one address under the limit", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => submit()));
    expect(results.filter((state) => state.ok)).toHaveLength(betaApplicationLimits.perIp);
    expect(await db.select().from(betaApplications)).toHaveLength(betaApplicationLimits.perIp);
  });
});

describe("admin review of beta applications", () => {
  it("lists applications for admins only and marks one reviewed with an audit trail free of applicant data", async () => {
    await submit();
    request.ip = "198.51.100.8";
    await submit(form({ company: "Second" }));

    request.admin = false;
    await expect(listBetaApplications()).rejects.toThrow();
    const denied = new FormData();
    denied.set("applicationId", randomUUID());
    await expect(markBetaApplicationReviewedAction(initialActionState(), denied)).rejects.toThrow();
    request.admin = true;

    const listed = await listBetaApplications({ status: "new" });
    expect(listed.map((row) => row.company)).toEqual(["Second", "Atelier Martin"]);
    expect(listed[0]).not.toHaveProperty("ipHash");

    const data = new FormData();
    data.set("applicationId", listed[1].id);
    expect(await markBetaApplicationReviewedAction(initialActionState(), data)).toMatchObject({ ok: true });
    expect(await markBetaApplicationReviewedAction(initialActionState(), data)).toMatchObject({ ok: true, message: expect.stringContaining("déjà") });
    expect((await listBetaApplications({ status: "new" })).map((row) => row.company)).toEqual(["Second"]);
    expect((await listBetaApplications({ status: "reviewed" }))[0]).toMatchObject({ reviewedBy: "admin-user", reviewedAt: expect.any(Date) });

    const audits = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "beta_application.reviewed"), eq(auditEvents.entityId, listed[1].id)));
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits).toLowerCase()).not.toContain("camille");
    await db.delete(auditEvents).where(eq(auditEvents.entityId, listed[1].id));

    data.set("applicationId", "not-a-uuid");
    expect(await markBetaApplicationReviewedAction(initialActionState(), data)).toMatchObject({ ok: false });
    data.set("applicationId", randomUUID());
    expect(await markBetaApplicationReviewedAction(initialActionState(), data)).toMatchObject({ ok: false });
  });
});
