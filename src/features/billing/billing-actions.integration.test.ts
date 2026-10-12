import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  workspace: { id: "", status: "approved" },
  checkoutEnabled: false,
  portal: vi.fn(async (input: { customer: string; return_url: string; locale?: string }) => ({ url: `https://billing.stripe.test/session?c=${input.customer}` })),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/i18n/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/current-workspace", () => ({
  currentWorkspace: vi.fn(async () => ({ workspace: state.workspace, userId: "user-1", orgId: "org-1", role: "owner" })),
}));
vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_APP_URL: "https://mail.example.test", STRIPE_TAX_MODE: "unconfigured", STRIPE_PRICE_PLATFORM: "price_platform", STRIPE_PRICE_USAGE: "price_usage" },
  isFeatureEnabled: () => state.checkoutEnabled,
}));
vi.mock("@/lib/stripe", () => ({ stripe: () => ({ billingPortal: { sessions: { create: state.portal } } }) }));

import { databasePool, requireDb } from "@/db/runtime";
import { subscriptions, workspaces } from "@/db/schema";
import { checkoutAction, portalAction } from "@/features/billing/actions";

const db = requireDb();
const errors = vi.spyOn(console, "error").mockImplementation(() => {});
afterEach(async () => {
  if (state.workspace.id) await db.delete(workspaces).where(eq(workspaces.id, state.workspace.id));
  state.checkoutEnabled = false;
  state.portal.mockClear();
  errors.mockClear();
});
afterAll(async () => { errors.mockRestore(); await databasePool!.end(); });

it("returns localized checkout refusals instead of throwing", async () => {
  state.workspace = { id: randomUUID(), status: "approved" };
  expect(await checkoutAction()).toMatchObject({ ok: false, message: "Subscriptions are temporarily closed while billing is being certified." });
  state.checkoutEnabled = true;
  state.workspace.status = "pending_review";
  expect(await checkoutAction()).toMatchObject({ ok: false, message: "Yodev must approve the application before you can subscribe." });
  state.workspace.status = "approved";
  expect(await checkoutAction()).toMatchObject({ ok: false, message: expect.stringContaining("tax setup") });
  expect(JSON.parse(errors.mock.calls.at(-1)![0] as string)).toEqual({ event: "billing_action_refused", action: "checkout", code: "tax_unconfigured", details: [] });
});

it("opens the portal with a localized return URL, or explains why it cannot", async () => {
  const id = randomUUID();
  state.workspace = { id, status: "approved" };
  await db.insert(workspaces).values({ id, name: "Billing", slug: id, status: "approved" });
  await db.insert(subscriptions).values({ workspaceId: id, plan: "beta", status: "inactive" });
  expect(await portalAction()).toMatchObject({ ok: false, message: "The subscription has not been created yet: complete the checkout first." });

  await db.update(subscriptions).set({ stripeCustomerId: `cus_${id.slice(0, 8)}` }).where(eq(subscriptions.workspaceId, id));
  await expect(portalAction()).rejects.toThrow(`REDIRECT:https://billing.stripe.test/session?c=cus_${id.slice(0, 8)}`);
  expect(state.portal).toHaveBeenCalledWith({ customer: `cus_${id.slice(0, 8)}`, locale: "en", return_url: "https://mail.example.test/en/dashboard/facturation" });

  state.portal.mockRejectedValueOnce(new Error("Stripe outage for customer@example.test"));
  expect(await portalAction()).toMatchObject({ ok: false, message: "Stripe is temporarily unavailable. Try again in a few minutes." });
  expect(JSON.stringify(errors.mock.calls)).not.toContain("customer@example.test");
});
