import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// env.ts is parsed on first import: open the onboarding gate, keep Postmark off.
vi.hoisted(() => {
  process.env.COMMERCIAL_ONBOARDING_ENABLED = "true";
  process.env.POSTMARK_ENABLED = "false";
});
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/page-auth", () => ({ requireAdmin: async () => ({ userId: "synthetic-admin" }) }));
vi.mock("@/i18n/server", () => ({ getLocale: async () => "fr" }));
vi.mock("@/lib/aws", () => ({ enqueueProviderProvisioning: vi.fn() }));
vi.mock("@/workers/provider-provisioning", () => ({ provisionBinding: vi.fn() }));

import { databasePool, requireDb } from "@/db/runtime";
import {
  auditEvents,
  authInvitations,
  authUsers,
  clientProvisioningRuns,
  subscriptions,
  workspaces,
} from "@/db/schema";
import { initialActionState } from "@/lib/action-state";
import {
  copyClientOwnerInvitationLinkAction,
  provisionClientWorkspaceAction,
  reviewTemplateAction,
  reviewTransactionalProfileAction,
  reviewWorkspaceAction,
  setPilotAccessAction,
  setProviderAccountStatusAction,
  setWorkspaceContentPolicyAction,
  type AdminActionState,
} from "./actions";

const db = requireDb();
const pool = databasePool!;
const initial = initialActionState() as AdminActionState;

async function cleanDatabase() {
  const result = await pool.query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public'");
  const names = result.rows.map(({ tablename }) => tablename).filter((name) => /^[a-z0-9_]+$/.test(name)).map((name) => `"${name}"`);
  if (names.length) await pool.query(`truncate table ${names.join(", ")} restart identity cascade`);
}

const client = {
  name: "Acme Factures",
  slug: "acme-factures",
  ownerEmail: "Owner@Acme.example.test",
  websiteUrl: "https://acme.example.test",
  useCase: "Reçus de paiement envoyés après chaque commande validée.",
  expectedMonthlyVolume: "1200",
};

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(async () => {
  await cleanDatabase();
  // The synthetic administrator must exist: invitations reference their inviter.
  await db.insert(authUsers).values({ id: "synthetic-admin", email: "admin@yodev.example.test", emailVerified: true, name: "Admin", role: "admin" });
});

afterAll(async () => {
  await cleanDatabase();
  await pool.end();
});

describe("client creation with Postmark off", () => {
  it("creates the client and returns an audited invitation link", async () => {
    const state = await provisionClientWorkspaceAction(initial, form(client));
    expect(state.ok).toBe(true);
    expect(state.message).toContain("Client créé");

    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.slug, client.slug));
    const [run] = await db.select().from(clientProvisioningRuns).where(eq(clientProvisioningRuns.workspaceId, workspace.id));
    expect(run.status).toBe("email_failed");
    const [invitation] = await db.select().from(authInvitations).where(eq(authInvitations.id, run.invitationId));
    expect(invitation).toMatchObject({ email: "owner@acme.example.test", role: "owner", status: "pending", organizationId: workspace.authOrganizationId });
    expect(state.data?.link?.url).toBe(`http://localhost:3000/fr/invitation?id=${invitation.id}`);

    const audits = await db.select().from(auditEvents).where(eq(auditEvents.workspaceId, workspace.id));
    expect(audits.map((event) => event.action).sort()).toEqual([
      "client.owner_invitation_delivery_failed",
      "client.workspace_provisioned",
      "workspace.invitation_link_copied",
    ]);
    expect(audits.find((event) => event.action === "workspace.invitation_link_copied")?.metadata).toMatchObject({ role: "owner", issuedBy: "platform_admin" });
    expect(JSON.stringify(audits)).not.toMatch(/acme\.example\.test|invitation\?id=/i);
  });

  it("copies the link on demand and stops once the invitation is no longer pending", async () => {
    await provisionClientWorkspaceAction(initial, form(client));
    const [run] = await db.select().from(clientProvisioningRuns);
    const copied = await copyClientOwnerInvitationLinkAction(run.id);
    expect(copied.ok).toBe(true);
    expect(copied.data?.link?.url).toContain(run.invitationId);

    await db.update(authInvitations).set({ status: "accepted" }).where(eq(authInvitations.id, run.invitationId));
    expect(await copyClientOwnerInvitationLinkAction(run.id)).toMatchObject({ ok: false, message: "Aucune invitation en attente pour ce provisionnement." });
    expect(await copyClientOwnerInvitationLinkAction("not-a-uuid")).toMatchObject({ ok: false, message: "Paramètres de l’action invalides." });
  });

  it("keeps every typed value and flags invalid fields", async () => {
    const state = await provisionClientWorkspaceAction(initial, form({ ...client, slug: "Not A Slug!", useCase: "trop court" }));
    expect(state.ok).toBe(false);
    expect(Object.keys(state.fieldErrors).sort()).toEqual(["slug", "useCase"]);
    expect(state.values).toMatchObject({ name: client.name, ownerEmail: client.ownerEmail, slug: "Not A Slug!", useCase: "trop court" });
    expect(await db.select().from(workspaces)).toHaveLength(0);
  });

  it("reports a slug already in use on the field", async () => {
    await provisionClientWorkspaceAction(initial, form(client));
    const state = await provisionClientWorkspaceAction(initial, form({ ...client, ownerEmail: "other@example.test" }));
    expect(state).toMatchObject({ ok: false, fieldErrors: { slug: ["Ce slug est déjà utilisé."] } });
    expect(await db.select().from(workspaces)).toHaveLength(1);
  });
});

describe("admin action parameters are validated at runtime", () => {
  async function workspace(status: "approved" | "sandbox" | "pending_review" = "approved") {
    const id = randomUUID();
    await db.insert(workspaces).values({ id, name: "Synthetic", slug: id, status });
    await db.insert(subscriptions).values({ workspaceId: id });
    return id;
  }

  it.each([
    ["workspace decision", (id: string) => reviewWorkspaceAction(id, "deleted" as never)],
    ["content policy", (id: string) => setWorkspaceContentPolicyAction(id, "raw_only" as never)],
    ["pilot duration", (id: string) => setPilotAccessAction(id, 45 as never)],
    ["workspace id", () => reviewWorkspaceAction("../../etc", "approved")],
    ["profile decision", () => reviewTransactionalProfileAction(randomUUID(), "maybe" as never)],
    ["template decision", () => reviewTemplateAction(randomUUID(), "maybe" as never)],
    ["provider account status", () => setProviderAccountStatusAction(randomUUID(), "deleted" as never)],
  ])("refuses an invalid %s without touching data", async (_label, call) => {
    const id = await workspace();
    expect(await call(id)).toMatchObject({ ok: false, message: "Paramètres de l’action invalides." });
    expect(await db.select().from(auditEvents)).toHaveLength(0);
    const [saved] = await db.select().from(workspaces).where(eq(workspaces.id, id));
    expect(saved).toMatchObject({ status: "approved", contentPolicy: "template_only" });
  });

  it("returns business refusals as structured results", async () => {
    const id = await workspace("sandbox");
    expect(await reviewWorkspaceAction(id, "approved")).toMatchObject({ ok: false, message: "Le dossier d’onboarding doit être complété avant l’approbation." });
    expect(await reviewWorkspaceAction(randomUUID(), "rejected")).toMatchObject({ ok: false, message: "Workspace introuvable." });
    expect(await setWorkspaceContentPolicyAction(randomUUID(), "hybrid")).toMatchObject({ ok: false, message: "Workspace introuvable." });
    expect(await db.select().from(auditEvents)).toHaveLength(0);
  });

  it("confirms a valid decision", async () => {
    const id = await workspace("pending_review");
    expect(await reviewWorkspaceAction(id, "approved")).toMatchObject({ ok: true, message: "Action enregistrée." });
    expect((await db.select().from(workspaces).where(eq(workspaces.id, id)))[0].status).toBe("approved");
  });
});
