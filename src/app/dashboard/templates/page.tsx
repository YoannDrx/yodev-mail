import { and, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { DashboardPage } from "@/components/dashboard-page";
import { Badge } from "@/components/ui/badge";
import { requireDb } from "@/db";
import { templates, transactionalProfiles } from "@/db/schema";
import { requirePageWorkspace } from "@/lib/page-auth";
import { localized, localizedPath } from "@/i18n/config";
import { statusLabel } from "@/i18n/format";
import { getLocale } from "@/i18n/server";
import { TemplateForm } from "./template-form";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: localized(await getLocale(), { fr: "Templates", en: "Templates" }) };
}

export default async function Page() {
  const locale = await getLocale();
  const copy = localized(locale, {
    fr: { title: "Templates transactionnels", description: "Chaque modèle est rattaché à un cas d’usage et soumis à validation avant un envoi live.", version: "Version", id: "ID du template (content.templateId)", copy: "Copier l’ID", copied: "ID copié", details: "Aperçu, appel API et versions", useCase: "Cas d’usage", empty: "Aucun template." },
    en: { title: "Transactional templates", description: "Each template is linked to a use case and submitted for approval before live sending.", version: "Version", id: "Template ID (content.templateId)", copy: "Copy ID", copied: "ID copied", details: "Preview, API call and versions", useCase: "Use case", empty: "No templates." },
  });
  const context = await requirePageWorkspace();
  const canManage = ["owner", "admin"].includes(context.role);
  const [rows, profiles] = await Promise.all([
    requireDb().select({ template: templates, profileKey: transactionalProfiles.key }).from(templates).leftJoin(transactionalProfiles, and(eq(transactionalProfiles.id, templates.transactionalProfileId), eq(transactionalProfiles.workspaceId, templates.workspaceId))).where(eq(templates.workspaceId, context.workspace.id)).orderBy(desc(templates.updatedAt)),
    requireDb().select().from(transactionalProfiles).where(eq(transactionalProfiles.workspaceId, context.workspace.id)).orderBy(desc(transactionalProfiles.createdAt)),
  ]);
  const options = profiles.filter((profile) => profile.status !== "disabled").map((profile) => ({ id: profile.id, label: `${profile.name} · ${statusLabel(locale, profile.status)}` }));
  return <DashboardPage title={copy.title} description={copy.description}>
    <TemplateForm canManage={canManage} locale={locale} profiles={options} />
    <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {rows.map(({ template, profileKey }) => <article className="grid content-start gap-4 rounded-md border bg-card p-5" key={template.id}>
        <div><h2 className="font-semibold">{template.name}</h2><p className="mt-1 text-sm text-muted-foreground">{template.subject}</p></div>
        <div className="flex flex-wrap items-center gap-2 text-xs"><Badge variant={template.reviewStatus === "approved" ? "default" : template.reviewStatus === "rejected" ? "destructive" : "secondary"}>{statusLabel(locale, template.reviewStatus)}</Badge><span className="text-muted-foreground">{copy.version} {template.currentVersion}</span>{profileKey ? <span className="text-muted-foreground">· {copy.useCase} <code>{profileKey}</code></span> : null}</div>
        <div className="grid gap-2"><p className="text-xs text-muted-foreground">{copy.id}</p><code className="break-all rounded bg-muted px-2 py-1 text-xs" data-template-id={template.id}>{template.id}</code><div><CopyButton copiedLabel={copy.copied} label={copy.copy} value={template.id} /></div></div>
        <Link className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline" href={localizedPath(locale, `/dashboard/templates/${template.id}`)}>{copy.details}<ArrowUpRight aria-hidden="true" className="size-4" /><span className="sr-only"> — {template.name}</span></Link>
      </article>)}
      {!rows.length && <p className="text-sm text-muted-foreground">{copy.empty}</p>}
    </div>
  </DashboardPage>;
}
