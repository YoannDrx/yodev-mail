"use server";

import { and, count, desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireDb } from "@/db";
import { auditEvents, domainProviderBindings, domains } from "@/db/schema";
import { domainPattern } from "@/features/domains/schema";
import { localized } from "@/i18n/config";
import { actionFailure, actionSuccess, formValues, type ActionState } from "@/lib/action-state";
import { ConsoleActionError, runConsoleAction } from "@/lib/console-action";
import { currentWorkspace } from "@/lib/current-workspace";
import { checkBinding } from "@/workers/domain-health";

const domainSchema = z.string().trim().toLowerCase().max(253).regex(new RegExp(`^${domainPattern}$`));

function overlaps(left: string, right: string) {
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}

const domainTaken = new ConsoleActionError({
  fr: "Ce domaine ou l’un de ses parents est déjà attribué à un autre workspace.",
  en: "This domain or one of its parents is already assigned to another workspace.",
}, "domain");

export async function addDomainAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runConsoleAction(formData, ["domain"], async (locale) => {
    const parsed = domainSchema.safeParse(formData.get("domain") ?? "");
    if (!parsed.success) {
      const message = localized(locale, {
        fr: "Saisissez un nom de domaine complet, sans https:// ni chemin (ex. notifications.client.com).",
        en: "Enter a full domain name, without https:// or a path (e.g. notifications.client.com).",
      });
      return actionFailure(message, { fieldErrors: { domain: [message] }, values: formValues(formData, ["domain"]) });
    }
    const name = parsed.data;
    const { workspace, userId } = await currentWorkspace({ admin: true });
    const db = requireDb();
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('yodev_mail_domain_ownership'))`);
      const [{ total }, allDomains] = await Promise.all([
        tx.select({ total: count() }).from(domains).where(eq(domains.workspaceId, workspace.id)).then((rows) => rows[0]),
        // Cross-workspace ownership check: only names are read, under the global lock.
        tx.select({ workspaceId: domains.workspaceId, name: domains.name }).from(domains),
      ]);
      const limit = workspace.status === "approved" ? 2 : 1;
      if (total >= limit) {
        throw new ConsoleActionError({
          fr: `Limite atteinte : ${limit} domaine${limit > 1 ? "s" : ""} pour ce workspace pendant la bêta.`,
          en: `Limit reached: ${limit} domain${limit > 1 ? "s" : ""} for this workspace during the beta.`,
        }, "domain");
      }
      if (allDomains.some((domain) => domain.workspaceId === workspace.id && domain.name === name)) {
        throw new ConsoleActionError({ fr: "Ce domaine est déjà ajouté.", en: "This domain has already been added." }, "domain");
      }
      if (allDomains.some((domain) => domain.workspaceId !== workspace.id && overlaps(domain.name, name))) {
        throw domainTaken;
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
    return actionSuccess(localized(locale, {
      fr: `${name} a été ajouté. Yodev prépare les enregistrements DNS.`,
      en: `${name} was added. Yodev is preparing the DNS records.`,
    }));
  }, { uniqueViolation: domainTaken });
}

// Bound to one domain; the previous state and form data are not needed.
export async function refreshDomainAction(domainId: string): Promise<ActionState> {
  return runConsoleAction(null, [], async (locale) => {
    const id = z.string().uuid().safeParse(domainId);
    if (!id.success) throw new ConsoleActionError({ fr: "Domaine introuvable.", en: "Domain not found." });
    const { workspace, userId } = await currentWorkspace({ admin: true });
    const db = requireDb();
    const [binding] = await db.select().from(domainProviderBindings).where(and(
      eq(domainProviderBindings.domainId, id.data),
      eq(domainProviderBindings.workspaceId, workspace.id),
    )).orderBy(desc(domainProviderBindings.isActive), desc(domainProviderBindings.createdAt)).limit(1);
    if (!binding) {
      throw new ConsoleActionError({
        fr: "Ce domaine n’est pas encore provisionné par Yodev : la vérification sera possible dès que les enregistrements DNS seront affichés.",
        en: "Yodev has not provisioned this domain yet: verification becomes available once the DNS records are shown.",
      });
    }
    await db.insert(auditEvents).values({
      workspaceId: workspace.id,
      actorUserId: userId,
      action: "domain.verification_requested",
      entityType: "domain",
      entityId: id.data,
    });
    await checkBinding(workspace.id, binding.id);
    revalidatePath("/dashboard/domaines");
    return actionSuccess(localized(locale, { fr: "Vérification DNS relancée.", en: "DNS verification requested." }));
  });
}
