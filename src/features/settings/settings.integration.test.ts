import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, expect, it, vi } from "vitest";

const context = vi.hoisted(() => ({ workspaceId: "", role: "admin" }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/i18n/server", () => ({ getLocale: async () => "fr" }));
vi.mock("@/lib/current-workspace", () => ({
  currentWorkspace: vi.fn(async (options: { admin?: boolean } = {}) => {
    if (options.admin && !["owner", "admin"].includes(context.role)) throw new Error("Workspace administrator role required.");
    return { workspace: { id: context.workspaceId }, userId: "user-1", orgId: "org-1", role: context.role };
  }),
}));

import { databasePool, requireDb } from "@/db/runtime";
import { workspaceSettings, workspaces } from "@/db/schema";
import { updateSettingsAction } from "@/features/settings/actions";
import { initialActionState } from "@/lib/action-state";

const db = requireDb();
afterEach(async () => {
  if (context.workspaceId) await db.delete(workspaces).where(eq(workspaces.id, context.workspaceId));
  context.role = "admin";
});
afterAll(async () => { await databasePool!.end(); });

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

it("saves the sender identity, reports invalid fields without losing input and clears empty fields", async () => {
  context.workspaceId = randomUUID();
  await db.insert(workspaces).values({ id: context.workspaceId, name: "Settings", slug: context.workspaceId });

  const invalid = await updateSettingsAction(initialActionState(), form({ companyName: "Atelier SAS", defaultReplyTo: "not-an-email" }));
  expect(invalid).toMatchObject({ ok: false, values: { companyName: "Atelier SAS", defaultReplyTo: "not-an-email" } });
  expect(invalid.fieldErrors.defaultReplyTo).toEqual(["Indiquez une adresse email valide ou laissez le champ vide."]);
  expect(await db.select().from(workspaceSettings).where(eq(workspaceSettings.workspaceId, context.workspaceId))).toHaveLength(0);

  expect(await updateSettingsAction(initialActionState(), form({ companyName: " Atelier SAS ", companyAddress: "1 rue de Paris", defaultFromName: "Atelier", defaultReplyTo: "support@atelier.example.test" })))
    .toMatchObject({ ok: true, message: "Paramètres enregistrés." });
  expect((await db.select().from(workspaceSettings).where(eq(workspaceSettings.workspaceId, context.workspaceId)))[0])
    .toMatchObject({ companyName: "Atelier SAS", defaultReplyTo: "support@atelier.example.test" });

  await updateSettingsAction(initialActionState(), form({ companyName: "Atelier SAS", companyAddress: "", defaultFromName: "", defaultReplyTo: "" }));
  expect((await db.select().from(workspaceSettings).where(eq(workspaceSettings.workspaceId, context.workspaceId)))[0])
    .toMatchObject({ companyAddress: null, defaultFromName: null, defaultReplyTo: null });

  context.role = "member";
  await expect(updateSettingsAction(initialActionState(), form({ companyName: "Hijack" }))).rejects.toThrow();
});
