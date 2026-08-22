import { desc } from "drizzle-orm";
import { AlertTriangle, Check, Pause, X } from "lucide-react";
import { requireDb } from "@/db";
import {
  domainProviderBindings,
  domains,
  clientProvisioningRuns,
  subscriptions,
  templates,
  transactionalProfiles,
  workspaceProviderAccounts,
  workspaces,
} from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  activateDomainBindingAction,
  provisionClientWorkspaceAction,
  disableDomainBindingAction,
  disableTemplateAction,
  disableTransactionalProfileAction,
  inviteWorkspaceMemberAction,
  provisionDomainAction,
  reconcileClientOwnerAction,
  reviewTemplateAction,
  reviewTransactionalProfileAction,
  reviewWorkspaceAction,
  retryClientOwnerInvitationAction,
  setProviderAccountStatusAction,
  setPilotAccessAction,
  setWorkspaceContentPolicyAction,
} from "@/features/admin/actions";
import { requireAdmin } from "@/lib/page-auth";
import { isFeatureEnabled } from "@/lib/env";
import { localized } from "@/i18n/config";
import { localeCode, statusLabel } from "@/i18n/format";
import { getLocale } from "@/i18n/server";

export const dynamic = "force-dynamic";

export default async function Page() {
  const locale = await getLocale();
  const formatLocale = localeCode(locale);
  const copy = localized(locale, {
    fr: { eyebrow:"CONSOLE INTERNE YODEV",title:"Validation transactionnelle et fournisseurs",intro:"Le fournisseur reste invisible côté client. Toute activation est auditée et débute à 50 emails par jour.",newClient:"Nouveau client",company:"Entreprise",ownerEmail:"Email du propriétaire",website:"Site web",monthly:"Volume mensuel attendu",useCase:"Cas d’usage transactionnel",create:"Créer et inviter le propriétaire",gate:"Le gate COMMERCIAL_ONBOARDING_ENABLED est fermé. Activez-le uniquement après migration et validation du parcours A/B en environnement isolé.",deleted:"Workspace supprimé",attempts:"tentative(s)",resend:"Renvoyer l’invitation",reconcile:"Réconcilier le propriétaire",workspaces:"Workspaces",siteMissing:"Site non renseigné",perMonth:"emails/mois",limit:"limite",perDay:"jour",useCaseMissing:"Cas d’usage non renseigné",pilot:"Droit pilote",until:"jusqu’au",inactive:"inactif",approve:"Approuver",pause:"Suspendre",reject:"Refuser",templatesOnly:"Templates seuls",allowRaw:"Autoriser raw",pilot30:"Pilote 30 jours",revokePilot:"Révoquer pilote",inviteMember:"Inviter un membre",reviewWarning:"Vérifier identité, site, application, déclencheurs et relation destinataire avant approbation.",useCases:"Cas d’usage",disable:"Désactiver",templates:"Templates",providerAccounts:"Comptes fournisseurs",reactivate:"Réactiver",domainsProviders:"Domaines et fournisseurs",activeProvider:"fournisseur actif",noActiveProvider:"aucun fournisseur actif",provision:"Provisionner",prepareSes:"Préparer SES",active:"actif",activate:"Activer"},
    en: { eyebrow:"YODEV INTERNAL CONSOLE",title:"Transactional and provider review",intro:"The provider remains invisible to customers. Every activation is audited and starts at 50 emails per day.",newClient:"New client",company:"Company",ownerEmail:"Owner email",website:"Website",monthly:"Expected monthly volume",useCase:"Transactional use case",create:"Create and invite owner",gate:"The COMMERCIAL_ONBOARDING_ENABLED gate is closed. Enable it only after migration and A/B journey validation in an isolated environment.",deleted:"Deleted workspace",attempts:"attempt(s)",resend:"Resend invitation",reconcile:"Reconcile owner",workspaces:"Workspaces",siteMissing:"Website not provided",perMonth:"emails/month",limit:"limit",perDay:"day",useCaseMissing:"Use case not provided",pilot:"Pilot entitlement",until:"until",inactive:"inactive",approve:"Approve",pause:"Pause",reject:"Reject",templatesOnly:"Templates only",allowRaw:"Allow raw",pilot30:"30-day pilot",revokePilot:"Revoke pilot",inviteMember:"Invite member",reviewWarning:"Verify identity, website, application, triggers, and recipient relationship before approval.",useCases:"Use cases",disable:"Disable",templates:"Templates",providerAccounts:"Provider accounts",reactivate:"Reactivate",domainsProviders:"Domains and providers",activeProvider:"active provider",noActiveProvider:"no active provider",provision:"Provision",prepareSes:"Prepare SES",active:"active",activate:"Activate"},
  });
  await requireAdmin();
  const db = requireDb();
  const [workspaceRows, profileRows, templateRows, domainRows, bindings, providerAccounts, subscriptionRows, provisioningRuns] = await Promise.all([
    db.select().from(workspaces).orderBy(desc(workspaces.createdAt)),
    db.select().from(transactionalProfiles).orderBy(desc(transactionalProfiles.createdAt)),
    db.select().from(templates).orderBy(desc(templates.createdAt)),
    db.select().from(domains).orderBy(desc(domains.createdAt)),
    db.select().from(domainProviderBindings).orderBy(desc(domainProviderBindings.createdAt)),
    db.select().from(workspaceProviderAccounts).orderBy(desc(workspaceProviderAccounts.createdAt)),
    db.select().from(subscriptions).orderBy(desc(subscriptions.createdAt)),
    db.select().from(clientProvisioningRuns).orderBy(desc(clientProvisioningRuns.createdAt)),
  ]);
  const commercialOnboardingEnabled = isFeatureEnabled("COMMERCIAL_ONBOARDING_ENABLED");

  return <main className="mx-auto min-h-screen max-w-7xl p-8">
    <p className="text-sm font-semibold text-primary">{copy.eyebrow}</p>
    <h1 className="mt-2 text-3xl font-semibold">{copy.title}</h1>
    <p className="mt-2 text-muted-foreground">{copy.intro}</p>

    <Section title={copy.newClient}>
      <form action={provisionClientWorkspaceAction} className="grid gap-4 rounded-2xl border bg-white p-6 lg:grid-cols-2">
        <label className="grid gap-1 text-sm">{copy.company}<input className="h-10 rounded-md border px-3" disabled={!commercialOnboardingEnabled} maxLength={140} minLength={2} name="name" required /></label>
        <label className="grid gap-1 text-sm">Slug<input className="h-10 rounded-md border px-3" disabled={!commercialOnboardingEnabled} maxLength={120} name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="acme" required /></label>
        <label className="grid gap-1 text-sm">{copy.ownerEmail}<input className="h-10 rounded-md border px-3" disabled={!commercialOnboardingEnabled} name="ownerEmail" required type="email" /></label>
        <label className="grid gap-1 text-sm">{copy.website}<input className="h-10 rounded-md border px-3" disabled={!commercialOnboardingEnabled} name="websiteUrl" required type="url" /></label>
        <label className="grid gap-1 text-sm">{copy.monthly}<input className="h-10 rounded-md border px-3" disabled={!commercialOnboardingEnabled} max={10_000_000} min={1} name="expectedMonthlyVolume" required type="number" /></label>
        <label className="grid gap-1 text-sm lg:col-span-2">{copy.useCase}<textarea className="min-h-28 rounded-md border p-3" disabled={!commercialOnboardingEnabled} maxLength={4_000} minLength={20} name="useCase" required /></label>
        <div className="lg:col-span-2"><Button disabled={!commercialOnboardingEnabled} type="submit">{copy.create}</Button></div>
        {!commercialOnboardingEnabled && <p className="text-sm text-amber-800 lg:col-span-2">{copy.gate}</p>}
      </form>
      {provisioningRuns.map((run) => {
        const workspace = workspaceRows.find((row) => row.id === run.workspaceId);
        return <article className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-white p-5" key={run.id}>
          <div><p className="font-semibold">{workspace?.name ?? copy.deleted}</p><p className="text-sm text-muted-foreground">Provisioning : {statusLabel(locale,run.status)} · {copy.attempts} {run.attemptCount}</p>{run.lastErrorCode && <p className="text-sm text-destructive">{run.lastErrorCode}</p>}</div>
          <div className="flex gap-2">
            {(run.status === "email_failed" || run.status === "invitation_sent") && <form action={retryClientOwnerInvitationAction.bind(null, run.id)}><Button disabled={!commercialOnboardingEnabled} size="sm" type="submit" variant="outline">{copy.resend}</Button></form>}
            {run.status === "invitation_sent" && <form action={reconcileClientOwnerAction.bind(null, run.id)}><Button size="sm" type="submit" variant="outline">{copy.reconcile}</Button></form>}
          </div>
        </article>;
      })}
    </Section>

    <Section title={copy.workspaces}>
      {workspaceRows.map((workspace) => {
        const subscription = subscriptionRows.find((row) => row.workspaceId === workspace.id);
        return <article className="rounded-2xl border bg-white p-6" key={workspace.id}>
        <div className="flex flex-col justify-between gap-4 lg:flex-row">
          <div>
            <div className="flex gap-3"><h2 className="font-semibold">{workspace.name}</h2><Badge variant={workspace.status === "rejected" ? "destructive" : "secondary"}>{statusLabel(locale,workspace.status)}</Badge><Badge variant="outline">{statusLabel(locale,workspace.contentPolicy)}</Badge></div>
            <p className="mt-2 text-sm text-muted-foreground">{workspace.websiteUrl ?? copy.siteMissing} · {workspace.expectedMonthlyVolume.toLocaleString(formatLocale)} {copy.perMonth} · {copy.limit} {workspace.dailyLimit}/{copy.perDay}</p>
            <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm">{workspace.useCase ?? copy.useCaseMissing}</p>
            <p className="mt-2 text-sm text-muted-foreground">{copy.pilot} : {subscription?.pilotAccessExpiresAt ? `${copy.until} ${subscription.pilotAccessExpiresAt.toLocaleString(formatLocale)}` : copy.inactive}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <form action={reviewWorkspaceAction.bind(null, workspace.id, "approved")}><Button size="sm" type="submit"><Check />{copy.approve}</Button></form>
            <form action={reviewWorkspaceAction.bind(null, workspace.id, "limited")}><Button size="sm" type="submit" variant="outline"><Pause />{copy.pause}</Button></form>
            <form action={reviewWorkspaceAction.bind(null, workspace.id, "rejected")}><Button size="sm" type="submit" variant="destructive"><X />{copy.reject}</Button></form>
            <form action={setWorkspaceContentPolicyAction.bind(null, workspace.id, workspace.contentPolicy === "hybrid" ? "template_only" : "hybrid")}><Button size="sm" type="submit" variant="outline">{workspace.contentPolicy === "hybrid" ? copy.templatesOnly : copy.allowRaw}</Button></form>
            {workspace.status === "approved" && <form action={setPilotAccessAction.bind(null, workspace.id, 30)}><Button size="sm" type="submit" variant="outline">{copy.pilot30}</Button></form>}
            {subscription?.pilotAccessExpiresAt && <form action={setPilotAccessAction.bind(null, workspace.id, null)}><Button size="sm" type="submit" variant="destructive">{copy.revokePilot}</Button></form>}
          </div>
        </div>
        {workspace.status === "approved" && <form action={inviteWorkspaceMemberAction.bind(null, workspace.id)} className="mt-4 flex max-w-xl gap-2">
          <input aria-label={`Inviter dans ${workspace.name}`} className="h-9 flex-1 rounded-md border px-3 text-sm" name="email" placeholder="membre@example.com" required type="email" />
          <Button size="sm" type="submit" variant="outline">{copy.inviteMember}</Button>
        </form>}
        {workspace.status === "pending_review" && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mr-2 inline size-4" />{copy.reviewWarning}</p>}
      </article>;})}
    </Section>

    <Section title={copy.useCases}>
      {profileRows.map((profile) => <article className="rounded-2xl border bg-white p-5" key={profile.id}><div className="flex flex-wrap justify-between gap-4">
        <div><div className="flex items-center gap-2"><h2 className="font-semibold">{profile.name}</h2><Badge variant="secondary">{statusLabel(locale,profile.status)}</Badge></div><p className="font-mono text-xs text-muted-foreground">{profile.key}</p><p className="mt-3 max-w-3xl text-sm">{profile.triggerDescription}</p><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{profile.recipientRelationship}</p></div>
        <div className="flex gap-2"><form action={reviewTransactionalProfileAction.bind(null, profile.id, "approved")}><Button size="sm">{copy.approve}</Button></form><form action={reviewTransactionalProfileAction.bind(null, profile.id, "rejected")}><Button size="sm" variant="destructive">{copy.reject}</Button></form><form action={disableTransactionalProfileAction.bind(null, profile.id)}><Button size="sm" variant="outline">{copy.disable}</Button></form></div>
      </div></article>)}
    </Section>

    <Section title={copy.templates}>
      {templateRows.map((template) => <article className="rounded-2xl border bg-white p-5" key={template.id}><div className="flex flex-wrap justify-between gap-4">
        <div><h2 className="font-semibold">{template.name}</h2><p className="text-sm text-muted-foreground">{template.subject} · {statusLabel(locale,template.reviewStatus)}</p></div>
        <div className="flex gap-2"><form action={reviewTemplateAction.bind(null, template.id, "approved")}><Button size="sm">{copy.approve}</Button></form><form action={reviewTemplateAction.bind(null, template.id, "rejected")}><Button size="sm" variant="destructive">{copy.reject}</Button></form><form action={disableTemplateAction.bind(null, template.id)}><Button size="sm" variant="outline">{copy.disable}</Button></form></div>
      </div></article>)}
    </Section>

    <Section title={copy.providerAccounts}>
      {providerAccounts.map((account) => <article className="rounded-2xl border bg-white p-5" key={account.id}><div className="flex flex-wrap items-center justify-between gap-3">
        <p><strong>{account.provider}</strong> · {statusLabel(locale,account.status)} · workspace {account.workspaceId}</p>
        <div className="flex gap-2"><form action={setProviderAccountStatusAction.bind(null, account.id, account.status === "paused" ? "ready" : "paused")}><Button size="sm" variant="outline">{account.status === "paused" ? copy.reactivate : copy.pause}</Button></form><form action={setProviderAccountStatusAction.bind(null, account.id, "disabled")}><Button size="sm" variant="destructive">{copy.disable}</Button></form></div>
      </div></article>)}
    </Section>

    <Section title={copy.domainsProviders}>
      {domainRows.map((domain) => {
        const domainBindings = bindings.filter((binding) => binding.domainId === domain.id);
        return <article className="rounded-2xl border bg-white p-5" key={domain.id}>
          <div className="flex flex-wrap justify-between gap-4">
            <div><h2 className="font-semibold">{domain.name}</h2><p className="text-sm text-muted-foreground">{statusLabel(locale,domain.status)}{domain.activeProvider ? ` · ${copy.activeProvider} ${domain.activeProvider}` : ` · ${copy.noActiveProvider}`}</p></div>
            <div className="flex gap-2"><form action={provisionDomainAction.bind(null, domain.id, "postmark")}><Button size="sm">{copy.provision}</Button></form><form action={provisionDomainAction.bind(null, domain.id, "ses")}><Button size="sm" variant="outline">{copy.prepareSes}</Button></form></div>
          </div>
          <div className="mt-4 grid gap-3">{domainBindings.map((binding) => <div className="rounded-xl border p-4 text-sm" key={binding.id}>
            <div className="flex flex-wrap items-center justify-between gap-3"><p><strong>{binding.provider}</strong> · {statusLabel(locale,binding.status)}{binding.isActive ? ` · ${copy.active}` : ""}</p><div className="flex gap-2">{binding.status === "verified" && !binding.isActive && <form action={activateDomainBindingAction.bind(null, binding.id)}><Button size="sm" variant="outline">{copy.activate}</Button></form>}{binding.status !== "disabled" && <form action={disableDomainBindingAction.bind(null, binding.id)}><Button size="sm" variant="destructive">{copy.disable}</Button></form>}</div></div>
            {binding.lastCheckError && <p className="mt-2 text-destructive">{binding.lastCheckError}</p>}
          </div>)}</div>
        </article>;
      })}
    </Section>
  </main>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-10"><h2 className="mb-4 text-xl font-semibold">{title}</h2><div className="grid gap-4">{children}</div></section>;
}
