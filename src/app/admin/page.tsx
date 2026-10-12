import type { Metadata } from "next";
import Link from "next/link";
import { desc } from "drizzle-orm";
import { AlertTriangle, Check, Link2, Pause, X } from "lucide-react";
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
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Badge } from "@/components/ui/badge";
import {
  activateDomainBindingAction,
  copyClientOwnerInvitationLinkAction,
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
import { AdminActionButton, AdminInviteMemberForm, ClientProvisioningForm } from "@/features/admin/admin-forms";
import { DailyLimitForm, ReviewApplicationButton } from "@/features/admin/admin-ops-forms";
import { listBetaApplications } from "@/features/applications/admin";
import { warmupLimitForStage } from "@/features/sending/warmup";
import { requireAdmin } from "@/lib/page-auth";
import { isFeatureEnabled } from "@/lib/env";
import { localized, localizedPath } from "@/i18n/config";
import { localeCode, statusLabel } from "@/i18n/format";
import { getLocale } from "@/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: (await getLocale()) === "fr" ? "Administration Yodev" : "Yodev administration",
    robots: { index: false, follow: false },
  };
}

export default async function Page() {
  const locale = await getLocale();
  const formatLocale = localeCode(locale);
  const copy = localized(locale, {
    fr: { eyebrow:"CONSOLE INTERNE YODEV",title:"Validation transactionnelle et fournisseurs",intro:"Le fournisseur reste invisible côté client. Toute activation est auditée et débute à 50 emails par jour.",newClient:"Nouveau client",company:"Entreprise",ownerEmail:"Email du propriétaire",website:"Site web",monthly:"Volume mensuel attendu",useCase:"Cas d’usage transactionnel",create:"Créer et inviter le propriétaire",creating:"Création…",gate:"Le gate COMMERCIAL_ONBOARDING_ENABLED est fermé. Activez-le uniquement après migration et validation du parcours A/B en environnement isolé.",deleted:"Workspace supprimé",attempts:"tentative(s)",resend:"Renvoyer l’invitation",copyLink:"Copier le lien d’invitation",reconcile:"Réconcilier le propriétaire",workspaces:"Workspaces",siteMissing:"Site non renseigné",perMonth:"emails/mois",limit:"limite",perDay:"jour",useCaseMissing:"Cas d’usage non renseigné",pilot:"Droit pilote",until:"jusqu’au",inactive:"inactif",approve:"Approuver",pause:"Suspendre",reject:"Refuser",templatesOnly:"Templates seuls",allowRaw:"Autoriser raw",pilot30:"Pilote 30 jours",revokePilot:"Révoquer pilote",inviteMember:"Inviter un membre",inviteInto:"Inviter dans",reviewWarning:"Vérifier identité, site, application, déclencheurs et relation destinataire avant approbation.",useCases:"Cas d’usage",disable:"Désactiver",templates:"Templates",providerAccounts:"Comptes fournisseurs",reactivate:"Réactiver",domainsProviders:"Domaines et fournisseurs",activeProvider:"fournisseur actif",noActiveProvider:"aucun fournisseur actif",provision:"Provisionner",prepareSes:"Préparer SES",active:"actif",activate:"Activer",signOut:"Se déconnecter",signingOut:"Déconnexion…",dashboard:"Console client",applications:"Candidatures bêta",noApplications:"Aucune candidature.",reviewed:"traitée",received:"reçue le",volume:"emails/mois annoncés",
      confirm: {
        pauseWorkspace: ["Suspendre ce workspace ?", "Les envois du workspace sont suspendus immédiatement et sa limite revient à 50 emails par jour."],
        rejectWorkspace: ["Refuser ce workspace ?", "Le dossier est refusé et le workspace ne peut plus envoyer d’emails."],
        revokePilot: ["Révoquer le droit pilote ?", "Le workspace perd immédiatement son accès pilote."],
        rejectProfile: ["Refuser ce cas d’usage ?", "Les envois rattachés à ce cas d’usage seront refusés."],
        disableProfile: ["Désactiver ce cas d’usage ?", "Les envois rattachés à ce cas d’usage seront refusés."],
        rejectTemplate: ["Refuser ce template ?", "Le template ne pourra plus être utilisé pour envoyer."],
        disableTemplate: ["Désactiver ce template ?", "Le template ne pourra plus être utilisé pour envoyer."],
        pauseAccount: ["Suspendre ce compte fournisseur ?", "Les envois passant par ce compte sont suspendus immédiatement."],
        disableAccount: ["Désactiver ce compte fournisseur ?", "Les envois passant par ce compte s’arrêtent définitivement jusqu’à réactivation manuelle."],
        disableBinding: ["Désactiver cette liaison fournisseur ?", "Si elle est active, le domaine n’aura plus de fournisseur et ses envois s’arrêteront."],
      },
    },
    en: { eyebrow:"YODEV INTERNAL CONSOLE",title:"Transactional and provider review",intro:"The provider remains invisible to customers. Every activation is audited and starts at 50 emails per day.",newClient:"New client",company:"Company",ownerEmail:"Owner email",website:"Website",monthly:"Expected monthly volume",useCase:"Transactional use case",create:"Create and invite owner",creating:"Creating…",gate:"The COMMERCIAL_ONBOARDING_ENABLED gate is closed. Enable it only after migration and A/B journey validation in an isolated environment.",deleted:"Deleted workspace",attempts:"attempt(s)",resend:"Resend invitation",copyLink:"Copy invitation link",reconcile:"Reconcile owner",workspaces:"Workspaces",siteMissing:"Website not provided",perMonth:"emails/month",limit:"limit",perDay:"day",useCaseMissing:"Use case not provided",pilot:"Pilot entitlement",until:"until",inactive:"inactive",approve:"Approve",pause:"Pause",reject:"Reject",templatesOnly:"Templates only",allowRaw:"Allow raw",pilot30:"30-day pilot",revokePilot:"Revoke pilot",inviteMember:"Invite member",inviteInto:"Invite into",reviewWarning:"Verify identity, website, application, triggers, and recipient relationship before approval.",useCases:"Use cases",disable:"Disable",templates:"Templates",providerAccounts:"Provider accounts",reactivate:"Reactivate",domainsProviders:"Domains and providers",activeProvider:"active provider",noActiveProvider:"no active provider",provision:"Provision",prepareSes:"Prepare SES",active:"active",activate:"Activate",signOut:"Sign out",signingOut:"Signing out…",dashboard:"Customer console",applications:"Beta applications",noApplications:"No applications.",reviewed:"reviewed",received:"received on",volume:"emails/month expected",
      confirm: {
        pauseWorkspace: ["Pause this workspace?", "The workspace stops sending immediately and its limit returns to 50 emails per day."],
        rejectWorkspace: ["Reject this workspace?", "The application is rejected and the workspace can no longer send email."],
        revokePilot: ["Revoke the pilot entitlement?", "The workspace immediately loses its pilot access."],
        rejectProfile: ["Reject this use case?", "Sends attached to this use case will be refused."],
        disableProfile: ["Disable this use case?", "Sends attached to this use case will be refused."],
        rejectTemplate: ["Reject this template?", "The template can no longer be used to send."],
        disableTemplate: ["Disable this template?", "The template can no longer be used to send."],
        pauseAccount: ["Pause this provider account?", "Sends through this account are paused immediately."],
        disableAccount: ["Disable this provider account?", "Sends through this account stop until it is manually reactivated."],
        disableBinding: ["Disable this provider binding?", "If it is active, the domain loses its provider and its sends stop."],
      },
    },
  });
  const confirm = (key: keyof typeof copy.confirm, label: string) => ({ title: copy.confirm[key][0], description: copy.confirm[key][1], label });
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
  const applications = await listBetaApplications({ limit: 100 });
  const commercialOnboardingEnabled = isFeatureEnabled("COMMERCIAL_ONBOARDING_ENABLED");

  return <main className="mx-auto min-h-screen max-w-7xl p-8">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-sm font-semibold text-primary">{copy.eyebrow}</p>
        <h1 className="mt-2 text-3xl font-semibold">{copy.title}</h1>
        <p className="mt-2 text-muted-foreground">{copy.intro}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Link className="text-sm font-medium text-primary underline-offset-4 hover:underline" href={localizedPath(locale, "/dashboard")}>{copy.dashboard}</Link>
        <SignOutButton label={copy.signOut} pendingLabel={copy.signingOut} redirectTo={localizedPath(locale, "/connexion")} />
      </div>
    </div>

    <Section title={copy.newClient}>
      <ClientProvisioningForm action={provisionClientWorkspaceAction} copy={{ company: copy.company, ownerEmail: copy.ownerEmail, website: copy.website, monthly: copy.monthly, useCase: copy.useCase, create: copy.create, creating: copy.creating, gate: copy.gate }} enabled={commercialOnboardingEnabled} locale={locale} />
      {provisioningRuns.map((run) => {
        const workspace = workspaceRows.find((row) => row.id === run.workspaceId);
        return <article className="flex flex-wrap items-start justify-between gap-4 rounded-md border bg-card p-5" key={run.id}>
          <div><p className="font-semibold">{workspace?.name ?? copy.deleted}</p><p className="text-sm text-muted-foreground">Provisioning : {statusLabel(locale,run.status)} · {copy.attempts} {run.attemptCount}</p>{run.lastErrorCode && <p className="text-sm text-destructive">{run.lastErrorCode}</p>}</div>
          <div className="flex flex-wrap items-start gap-2">
            {(run.status === "email_failed" || run.status === "invitation_sent") && <AdminActionButton action={retryClientOwnerInvitationAction.bind(null, run.id)} disabled={!commercialOnboardingEnabled} locale={locale} variant="outline">{copy.resend}</AdminActionButton>}
            {run.status !== "accepted" && workspace && <AdminActionButton action={copyClientOwnerInvitationLinkAction.bind(null, run.id)} locale={locale} variant={run.status === "email_failed" ? "default" : "outline"}><Link2 />{copy.copyLink}</AdminActionButton>}
            {run.status === "invitation_sent" && <AdminActionButton action={reconcileClientOwnerAction.bind(null, run.id)} locale={locale} variant="outline">{copy.reconcile}</AdminActionButton>}
          </div>
        </article>;
      })}
    </Section>

    <Section title={copy.applications}>
      {applications.length ? applications.map((application) => <article className="flex flex-wrap items-start justify-between gap-4 rounded-md border bg-card p-5" key={application.id}>
        <div className="max-w-3xl">
          <div className="flex items-center gap-2"><h3 className="font-semibold">{application.company}</h3>{application.status === "reviewed" && <Badge variant="secondary">{copy.reviewed}</Badge>}</div>
          <p className="text-sm text-muted-foreground">{application.contactName} · {application.workEmail}{application.websiteUrl ? ` · ${application.websiteUrl}` : ""} · {application.expectedMonthlyVolume.toLocaleString(formatLocale)} {copy.volume} · {copy.received} {application.createdAt.toLocaleString(formatLocale, { timeZone: "Europe/Paris", timeZoneName: "short" })}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm">{application.useCase}</p>
        </div>
        {application.status === "new" && <ReviewApplicationButton applicationId={application.id} locale={locale} />}
      </article>) : <p className="text-sm text-muted-foreground">{copy.noApplications}</p>}
    </Section>

    <Section title={copy.workspaces}>
      {workspaceRows.map((workspace) => {
        const subscription = subscriptionRows.find((row) => row.workspaceId === workspace.id);
        return <article className="rounded-md border bg-card p-6" key={workspace.id}>
        <div className="flex flex-col justify-between gap-4 lg:flex-row">
          <div>
            <div className="flex gap-3"><h2 className="font-semibold">{workspace.name}</h2><Badge variant={workspace.status === "rejected" ? "destructive" : "secondary"}>{statusLabel(locale,workspace.status)}</Badge><Badge variant="outline">{statusLabel(locale,workspace.contentPolicy)}</Badge></div>
            <p className="mt-2 text-sm text-muted-foreground">{workspace.websiteUrl ?? copy.siteMissing} · {workspace.expectedMonthlyVolume.toLocaleString(formatLocale)} {copy.perMonth} · {copy.limit} {workspace.dailyLimit}/{copy.perDay}</p>
            <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm">{workspace.useCase ?? copy.useCaseMissing}</p>
            <p className="mt-2 text-sm text-muted-foreground">{copy.pilot} : {subscription?.pilotAccessExpiresAt ? `${copy.until} ${subscription.pilotAccessExpiresAt.toLocaleString(formatLocale, { timeZone: "Europe/Paris", timeZoneName: "short" })}` : copy.inactive}</p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <AdminActionButton action={reviewWorkspaceAction.bind(null, workspace.id, "approved")} disabled={workspace.status !== "pending_review"} locale={locale}><Check />{copy.approve}</AdminActionButton>
            <AdminActionButton action={reviewWorkspaceAction.bind(null, workspace.id, "limited")} confirm={confirm("pauseWorkspace", copy.pause)} locale={locale} variant="outline"><Pause />{copy.pause}</AdminActionButton>
            <AdminActionButton action={reviewWorkspaceAction.bind(null, workspace.id, "rejected")} confirm={confirm("rejectWorkspace", copy.reject)} locale={locale} variant="destructive"><X />{copy.reject}</AdminActionButton>
            <AdminActionButton action={setWorkspaceContentPolicyAction.bind(null, workspace.id, workspace.contentPolicy === "hybrid" ? "template_only" : "hybrid")} locale={locale} variant="outline">{workspace.contentPolicy === "hybrid" ? copy.templatesOnly : copy.allowRaw}</AdminActionButton>
            {workspace.status === "approved" && <AdminActionButton action={setPilotAccessAction.bind(null, workspace.id, 30)} locale={locale} variant="outline">{copy.pilot30}</AdminActionButton>}
            {subscription?.pilotAccessExpiresAt && <AdminActionButton action={setPilotAccessAction.bind(null, workspace.id, null)} confirm={confirm("revokePilot", copy.revokePilot)} locale={locale} variant="destructive">{copy.revokePilot}</AdminActionButton>}
          </div>
        </div>
        {!workspace.deletedAt && <DailyLimitForm automatic={warmupLimitForStage(workspace.warmupStage)} current={workspace.dailyLimit} locale={locale} overridden={Boolean(workspace.dailyLimitOverriddenAt)} workspaceId={workspace.id} />}
        {workspace.status === "approved" && <AdminInviteMemberForm action={inviteWorkspaceMemberAction.bind(null, workspace.id)} inputLabel={`${copy.inviteInto} ${workspace.name}`} label={copy.inviteMember} locale={locale} />}
        {workspace.status === "pending_review" && <p className="mt-4 rounded-md y-status-warning p-3 text-sm text-[var(--y-warning)]"><AlertTriangle className="mr-2 inline size-4" />{copy.reviewWarning}</p>}
      </article>;})}
    </Section>

    <Section title={copy.useCases}>
      {profileRows.map((profile) => <article className="rounded-md border bg-card p-5" key={profile.id}><div className="flex flex-wrap justify-between gap-4">
        <div><div className="flex items-center gap-2"><h2 className="font-semibold">{profile.name}</h2><Badge variant="secondary">{statusLabel(locale,profile.status)}</Badge></div><p className="font-mono text-xs text-muted-foreground">{profile.key}</p><p className="mt-3 max-w-3xl text-sm">{profile.triggerDescription}</p><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{profile.recipientRelationship}</p></div>
        <div className="flex flex-wrap items-start gap-2">
          <AdminActionButton action={reviewTransactionalProfileAction.bind(null, profile.id, "approved")} locale={locale}>{copy.approve}</AdminActionButton>
          <AdminActionButton action={reviewTransactionalProfileAction.bind(null, profile.id, "rejected")} confirm={confirm("rejectProfile", copy.reject)} locale={locale} variant="destructive">{copy.reject}</AdminActionButton>
          <AdminActionButton action={disableTransactionalProfileAction.bind(null, profile.id)} confirm={confirm("disableProfile", copy.disable)} locale={locale} variant="outline">{copy.disable}</AdminActionButton>
        </div>
      </div></article>)}
    </Section>

    <Section title={copy.templates}>
      {templateRows.map((template) => <article className="rounded-md border bg-card p-5" key={template.id}><div className="flex flex-wrap justify-between gap-4">
        <div><h2 className="font-semibold">{template.name}</h2><p className="text-sm text-muted-foreground">{template.subject} · {statusLabel(locale,template.reviewStatus)}</p></div>
        <div className="flex flex-wrap items-start gap-2">
          <AdminActionButton action={reviewTemplateAction.bind(null, template.id, "approved")} locale={locale}>{copy.approve}</AdminActionButton>
          <AdminActionButton action={reviewTemplateAction.bind(null, template.id, "rejected")} confirm={confirm("rejectTemplate", copy.reject)} locale={locale} variant="destructive">{copy.reject}</AdminActionButton>
          <AdminActionButton action={disableTemplateAction.bind(null, template.id)} confirm={confirm("disableTemplate", copy.disable)} locale={locale} variant="outline">{copy.disable}</AdminActionButton>
        </div>
      </div></article>)}
    </Section>

    <Section title={copy.providerAccounts}>
      {providerAccounts.map((account) => <article className="rounded-md border bg-card p-5" key={account.id}><div className="flex flex-wrap items-center justify-between gap-3">
        <p><strong>{account.provider}</strong> · {statusLabel(locale,account.status)} · workspace {account.workspaceId}</p>
        <div className="flex flex-wrap items-start gap-2">
          {account.status === "paused"
            ? <AdminActionButton action={setProviderAccountStatusAction.bind(null, account.id, "ready")} locale={locale} variant="outline">{copy.reactivate}</AdminActionButton>
            : <AdminActionButton action={setProviderAccountStatusAction.bind(null, account.id, "paused")} confirm={confirm("pauseAccount", copy.pause)} locale={locale} variant="outline">{copy.pause}</AdminActionButton>}
          <AdminActionButton action={setProviderAccountStatusAction.bind(null, account.id, "disabled")} confirm={confirm("disableAccount", copy.disable)} locale={locale} variant="destructive">{copy.disable}</AdminActionButton>
        </div>
      </div></article>)}
    </Section>

    <Section title={copy.domainsProviders}>
      {domainRows.map((domain) => {
        const domainBindings = bindings.filter((binding) => binding.domainId === domain.id);
        return <article className="rounded-md border bg-card p-5" key={domain.id}>
          <div className="flex flex-wrap justify-between gap-4">
            <div><h2 className="font-semibold">{domain.name}</h2><p className="text-sm text-muted-foreground">{statusLabel(locale,domain.status)}{domain.activeProvider ? ` · ${copy.activeProvider} ${domain.activeProvider}` : ` · ${copy.noActiveProvider}`}</p></div>
            <div className="flex flex-wrap items-start gap-2">
              <AdminActionButton action={provisionDomainAction.bind(null, domain.id, "postmark")} locale={locale}>{copy.provision}</AdminActionButton>
              <AdminActionButton action={provisionDomainAction.bind(null, domain.id, "ses")} locale={locale} variant="outline">{copy.prepareSes}</AdminActionButton>
            </div>
          </div>
          <div className="mt-4 grid gap-3">{domainBindings.map((binding) => <div className="rounded-md border p-4 text-sm" key={binding.id}>
            <div className="flex flex-wrap items-center justify-between gap-3"><p><strong>{binding.provider}</strong> · {statusLabel(locale,binding.status)}{binding.isActive ? ` · ${copy.active}` : ""}</p><div className="flex flex-wrap items-start gap-2">{binding.status === "verified" && !binding.isActive && <AdminActionButton action={activateDomainBindingAction.bind(null, binding.id)} locale={locale} variant="outline">{copy.activate}</AdminActionButton>}{binding.status !== "disabled" && <AdminActionButton action={disableDomainBindingAction.bind(null, binding.id)} confirm={confirm("disableBinding", copy.disable)} locale={locale} variant="destructive">{copy.disable}</AdminActionButton>}</div></div>
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
