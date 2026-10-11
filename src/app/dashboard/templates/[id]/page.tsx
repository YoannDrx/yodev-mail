import { and, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { CopyButton } from "@/components/copy-button";
import { DashboardPage } from "@/components/dashboard-page";
import { Badge } from "@/components/ui/badge";
import { requireDb } from "@/db";
import { domains, templates, templateVersions, transactionalProfiles } from "@/db/schema";
import { apiBaseUrl, templateCurlExample, testKeyPlaceholder } from "@/features/templates/api-example";
import { extractTemplateVariables } from "@/features/templates/render";
import { dateTimeFormatter } from "@/lib/date-time";
import { requirePageWorkspace } from "@/lib/page-auth";
import { getWorkspaceTimeZone } from "@/lib/workspace-time-zone";
import { localized, localizedPath } from "@/i18n/config";
import { statusLabel } from "@/i18n/format";
import { getLocale } from "@/i18n/server";
import { TemplateForm, TemplatePreview } from "../template-form";

export const dynamic = "force-dynamic";

async function loadTemplate(id: string) {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) notFound();
  const context = await requirePageWorkspace();
  const db = requireDb();
  const [row] = await db.select({ template: templates, profile: transactionalProfiles })
    .from(templates)
    .leftJoin(transactionalProfiles, and(eq(transactionalProfiles.id, templates.transactionalProfileId), eq(transactionalProfiles.workspaceId, templates.workspaceId)))
    .where(and(eq(templates.id, parsed.data), eq(templates.workspaceId, context.workspace.id)))
    .limit(1);
  if (!row) notFound();
  return { context, ...row };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const locale = await getLocale();
  const { template } = await loadTemplate((await params).id);
  return { title: localized(locale, { fr: `Template ${template.name}`, en: `Template ${template.name}` }) };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const locale = await getLocale();
  const { context, template, profile } = await loadTemplate((await params).id);
  const db = requireDb();
  const [versions, verifiedDomains, timeZone] = await Promise.all([
    db.select().from(templateVersions).where(and(eq(templateVersions.templateId, template.id), eq(templateVersions.workspaceId, context.workspace.id))).orderBy(desc(templateVersions.version)),
    db.select({ name: domains.name }).from(domains).where(and(eq(domains.workspaceId, context.workspace.id), eq(domains.status, "verified"))).orderBy(desc(domains.createdAt)).limit(1),
    getWorkspaceTimeZone(context.workspace.id),
  ]);
  const latest = versions[0];
  const variables = latest ? extractTemplateVariables(template.subject, latest.html, latest.plainText) : [];
  const curl = templateCurlExample({
    baseUrl: apiBaseUrl(),
    templateId: template.id,
    category: profile?.key ?? "votre_categorie",
    fromDomain: verifiedDomains[0]?.name ?? "votre-domaine.fr",
    variables,
  });
  const canManage = ["owner", "admin"].includes(context.role);
  const copy = localized(locale, {
    fr: { back: "Tous les templates", description: "Identifiant, appel API en mode test, aperçu et historique des versions.", id: "ID du template", copyId: "Copier l’ID", copiedId: "ID copié", example: "Appel de test", exampleText: `Remplacez ${testKeyPlaceholder} par une clé de test : l’appel effectue toutes les vérifications et répond 202 avec le statut « simulated », sans livraison ni facturation.`, copyCurl: "Copier l’appel", copiedCurl: "Appel copié", prerequisites: "Pour que cet appel réussisse :", templateApproved: "le template doit être approuvé", profileApproved: "le cas d’usage doit être approuvé", domainVerified: "un domaine expéditeur doit être vérifié", ready: "Toutes les conditions sont réunies pour un envoi de test.", current: "Version en service", edit: "Modifier", versions: "Versions", version: "Version", created: "créée le", status: "Statut", useCase: "Cas d’usage", missingProfile: "aucun" },
    en: { back: "All templates", description: "Identifier, test-mode API call, preview and version history.", id: "Template ID", copyId: "Copy ID", copiedId: "ID copied", example: "Test call", exampleText: `Replace ${testKeyPlaceholder} with a test key: the call runs every check and answers 202 with the “simulated” status, without delivery or billing.`, copyCurl: "Copy call", copiedCurl: "Call copied", prerequisites: "For this call to succeed:", templateApproved: "the template must be approved", profileApproved: "the use case must be approved", domainVerified: "a sending domain must be verified", ready: "Every condition for a test send is met.", current: "Current version", edit: "Edit", versions: "Versions", version: "Version", created: "created on", status: "Status", useCase: "Use case", missingProfile: "none" },
  });
  const missing = [
    template.reviewStatus !== "approved" ? copy.templateApproved : null,
    profile?.status !== "approved" ? copy.profileApproved : null,
    !verifiedDomains.length ? copy.domainVerified : null,
  ].filter(Boolean);
  const dateFormat = dateTimeFormatter(locale, timeZone);
  return <DashboardPage
    action={<Link className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground" href={localizedPath(locale, "/dashboard/templates")}><ArrowLeft aria-hidden="true" className="size-4" />{copy.back}</Link>}
    description={copy.description}
    title={template.name}
  >
    <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
      <section aria-labelledby="template-id-title" className="grid content-start gap-3 rounded-md border bg-card p-6">
        <div className="flex flex-wrap items-center gap-2"><Badge variant={template.reviewStatus === "approved" ? "default" : "secondary"}>{statusLabel(locale, template.reviewStatus)}</Badge><span className="text-sm text-muted-foreground">{copy.version} {template.currentVersion} · {copy.useCase} <code>{profile?.key ?? copy.missingProfile}</code></span></div>
        <h2 className="font-semibold" id="template-id-title">{copy.id}</h2>
        <code className="break-all rounded bg-muted px-2 py-1 text-sm" data-template-id={template.id}>{template.id}</code>
        <div><CopyButton copiedLabel={copy.copiedId} label={copy.copyId} value={template.id} /></div>
      </section>
      <section aria-labelledby="template-example-title" className="grid content-start gap-3 rounded-md border bg-card p-6">
        <h2 className="font-semibold" id="template-example-title">{copy.example}</h2>
        <p className="text-sm text-muted-foreground">{copy.exampleText}</p>
        <pre className="overflow-x-auto rounded-md bg-muted p-4 text-xs leading-5" data-testid="template-curl"><code>{curl}</code></pre>
        <div><CopyButton copiedLabel={copy.copiedCurl} label={copy.copyCurl} value={curl} /></div>
        {missing.length ? <div className="text-sm"><p>{copy.prerequisites}</p><ul className="mt-1 list-disc pl-5 text-muted-foreground">{missing.map((item) => <li key={item}>{item}</li>)}</ul></div> : <p className="text-sm text-[var(--y-success)]">{copy.ready}</p>}
      </section>
    </div>
    {latest ? <section className="mt-6 rounded-md border bg-card p-6"><TemplatePreview body={latest.plainText} html={latest.html} locale={locale} subject={template.subject} title={`${copy.current} (${latest.version})`} /></section> : null}
    <section aria-labelledby="template-edit-title" className="mt-6 grid gap-4">
      <h2 className="text-xl font-semibold" id="template-edit-title">{copy.edit}</h2>
      <TemplateForm canManage={canManage && template.reviewStatus !== "disabled"} locale={locale} template={{ id: template.id, name: template.name, subject: template.subject, body: latest?.plainText ?? "" }} />
    </section>
    <section aria-labelledby="template-versions-title" className="mt-6 rounded-md border bg-card">
      <h2 className="border-b p-5 font-semibold" id="template-versions-title">{copy.versions}</h2>
      <ol className="divide-y">{versions.map((version) => <li className="flex flex-wrap justify-between gap-2 px-5 py-3 text-sm" key={version.id}><span className="font-medium">{copy.version} {version.version}</span><span className="text-muted-foreground">{copy.created} <time dateTime={version.createdAt.toISOString()}>{dateFormat.format(version.createdAt)}</time></span></li>)}</ol>
    </section>
  </DashboardPage>;
}
