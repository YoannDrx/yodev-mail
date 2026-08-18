"use server";

import { and, count, desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireDb } from "@/db";
import { auditEvents, domainProviderBindings, domains } from "@/db/schema";
import { currentWorkspace } from "@/lib/current-workspace";
import { checkBinding } from "@/workers/domain-health";

const domainSchema = z.string().trim().toLowerCase().regex(/^(?!-)(?:[a-z0-9-]+\.)+[a-z]{2,63}$/);

function overlaps(left: string, right: string) {
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}

export async function addDomainAction(value: string | FormData) {
  const raw = value instanceof FormData ? value.get("domain") : value;
  const name = domainSchema.parse(raw);
  const { workspace, userId } = await currentWorkspace({ admin: true });
  const db = requireDb();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('yodev_mail_domain_ownership'))`);
    const [{ total }, allDomains] = await Promise.all([
      tx.select({ total: count() }).from(domains).where(eq(domains.workspaceId, workspace.id)).then((rows) => rows[0]),
      tx.select({ workspaceId: domains.workspaceId, name: domains.name }).from(domains),
    ]);
    const limit = workspace.status === "approved" ? 2 : 1;
    if (total >= limit) throw new Error("Domain limit reached for this beta workspace");
    if (allDomains.some((domain) => domain.workspaceId !== workspace.id && overlaps(domain.name, name))) {
      throw new Error("Ce domaine ou l’un de ses parents est déjà attribué à un autre workspace.");
    }
    const [domain] = await tx.insert(domains).values({ workspaceId: workspace.id, name, status: "pending" }).returning();
    await tx.insert(auditEvents).values({
      workspaceId: workspace.id,
      actorUserId: userId,
      action: "domain.submitted",
      entityType: "domain",
      entityId: domain.id,
      metadata: { domain: name },
    });
  });
  revalidatePath("/dashboard/domaines");
}

export async function refreshDomainAction(domainId: string) {
  const id = z.string().uuid().parse(domainId);
  const { workspace, userId } = await currentWorkspace({ admin: true });
  const db = requireDb();
  const [binding] = await db.select().from(domainProviderBindings).where(and(
    eq(domainProviderBindings.domainId, id),
    eq(domainProviderBindings.workspaceId, workspace.id),
  )).orderBy(desc(domainProviderBindings.isActive), desc(domainProviderBindings.createdAt)).limit(1);
  if (!binding) throw new Error("Le domaine n’est pas encore provisionné par Yodev.");
  await db.insert(auditEvents).values({
    workspaceId: workspace.id,
    actorUserId: userId,
    action: "domain.verification_requested",
    entityType: "domain",
    entityId: id,
  });
  await checkBinding(binding.id);
  revalidatePath("/dashboard/domaines");
}
