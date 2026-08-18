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

export const dynamic = "force-dynamic";

export default async function Page() {
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
    <p className="text-sm font-semibold text-primary">CONSOLE INTERNE YODEV</p>
    <h1 className="mt-2 text-3xl font-semibold">Validation transactionnelle et fournisseurs</h1>
    <p className="mt-2 text-muted-foreground">Le fournisseur reste invisible côté client. Toute activation est auditée et débute à 50 emails par jour.</p>

    <Section title="Nouveau client">
      <form action={provisionClientWorkspaceAction} className="grid gap-4 rounded-2xl border bg-white p-6 lg:grid-cols-2">
        <label className="grid gap-1 text-sm">Entreprise<input className="h-10 rounded-md border px-3" disabled={!commercialOnboardingEnabled} maxLength={140} minLength={2} name="name" required /></label>
        <label className="grid gap-1 text-sm">Slug<input className="h-10 rounded-md border px-3" disabled={!commercialOnboardingEnabled} maxLength={120} name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="acme" required /></label>
        <label className="grid gap-1 text-sm">Email du propriétaire<input className="h-10 rounded-md border px-3" disabled={!commercialOnboardingEnabled} name="ownerEmail" required type="email" /></label>
        <label className="grid gap-1 text-sm">Site web<input className="h-10 rounded-md border px-3" disabled={!commercialOnboardingEnabled} name="websiteUrl" required type="url" /></label>
        <label className="grid gap-1 text-sm">Volume mensuel attendu<input className="h-10 rounded-md border px-3" disabled={!commercialOnboardingEnabled} max={10_000_000} min={1} name="expectedMonthlyVolume" required type="number" /></label>
        <label className="grid gap-1 text-sm lg:col-span-2">Cas d’usage transactionnel<textarea className="min-h-28 rounded-md border p-3" disabled={!commercialOnboardingEnabled} maxLength={4_000} minLength={20} name="useCase" required /></label>
        <div className="lg:col-span-2"><Button disabled={!commercialOnboardingEnabled} type="submit">Créer et inviter le propriétaire</Button></div>
        {!commercialOnboardingEnabled && <p className="text-sm text-amber-800 lg:col-span-2">Le gate COMMERCIAL_ONBOARDING_ENABLED est fermé. Activez-le uniquement après migration et validation du parcours A/B en environnement isolé.</p>}
      </form>
      {provisioningRuns.map((run) => {
        const workspace = workspaceRows.find((row) => row.id === run.workspaceId);
        return <article className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-white p-5" key={run.id}>
          <div><p className="font-semibold">{workspace?.name ?? "Workspace supprimé"}</p><p className="text-sm text-muted-foreground">Provisioning : {run.status} · tentative(s) {run.attemptCount}</p>{run.lastErrorCode && <p className="text-sm text-destructive">{run.lastErrorCode}</p>}</div>
          <div className="flex gap-2">
            {(run.status === "email_failed" || run.status === "invitation_sent") && <form action={retryClientOwnerInvitationAction.bind(null, run.id)}><Button disabled={!commercialOnboardingEnabled} size="sm" type="submit" variant="outline">Renvoyer l’invitation</Button></form>}
            {run.status === "invitation_sent" && <form action={reconcileClientOwnerAction.bind(null, run.id)}><Button size="sm" type="submit" variant="outline">Réconcilier le propriétaire</Button></form>}
          </div>
        </article>;
      })}
    </Section>

    <Section title="Workspaces">
      {workspaceRows.map((workspace) => {
        const subscription = subscriptionRows.find((row) => row.workspaceId === workspace.id);
        return <article className="rounded-2xl border bg-white p-6" key={workspace.id}>
        <div className="flex flex-col justify-between gap-4 lg:flex-row">
          <div>
            <div className="flex gap-3"><h2 className="font-semibold">{workspace.name}</h2><Badge variant={workspace.status === "rejected" ? "destructive" : "secondary"}>{workspace.status}</Badge><Badge variant="outline">{workspace.contentPolicy}</Badge></div>
            <p className="mt-2 text-sm text-muted-foreground">{workspace.websiteUrl ?? "Site non renseigné"} · {workspace.expectedMonthlyVolume.toLocaleString("fr-FR")} emails/mois · limite {workspace.dailyLimit}/jour</p>
            <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm">{workspace.useCase ?? "Cas d’usage non renseigné"}</p>
            <p className="mt-2 text-sm text-muted-foreground">Droit pilote : {subscription?.pilotAccessExpiresAt ? `jusqu’au ${subscription.pilotAccessExpiresAt.toLocaleString("fr-FR")}` : "inactif"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <form action={reviewWorkspaceAction.bind(null, workspace.id, "approved")}><Button size="sm" type="submit"><Check />Approuver</Button></form>
            <form action={reviewWorkspaceAction.bind(null, workspace.id, "limited")}><Button size="sm" type="submit" variant="outline"><Pause />Suspendre</Button></form>
            <form action={reviewWorkspaceAction.bind(null, workspace.id, "rejected")}><Button size="sm" type="submit" variant="destructive"><X />Refuser</Button></form>
            <form action={setWorkspaceContentPolicyAction.bind(null, workspace.id, workspace.contentPolicy === "hybrid" ? "template_only" : "hybrid")}><Button size="sm" type="submit" variant="outline">{workspace.contentPolicy === "hybrid" ? "Templates seuls" : "Autoriser raw"}</Button></form>
            {workspace.status === "approved" && <form action={setPilotAccessAction.bind(null, workspace.id, 30)}><Button size="sm" type="submit" variant="outline">Pilote 30 jours</Button></form>}
            {subscription?.pilotAccessExpiresAt && <form action={setPilotAccessAction.bind(null, workspace.id, null)}><Button size="sm" type="submit" variant="destructive">Révoquer pilote</Button></form>}
          </div>
        </div>
        {workspace.status === "approved" && <form action={inviteWorkspaceMemberAction.bind(null, workspace.id)} className="mt-4 flex max-w-xl gap-2">
          <input aria-label={`Inviter dans ${workspace.name}`} className="h-9 flex-1 rounded-md border px-3 text-sm" name="email" placeholder="membre@example.com" required type="email" />
          <Button size="sm" type="submit" variant="outline">Inviter un membre</Button>
        </form>}
        {workspace.status === "pending_review" && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mr-2 inline size-4" />Vérifier identité, site, application, déclencheurs et relation destinataire avant approbation.</p>}
      </article>;})}
    </Section>

    <Section title="Cas d’usage">
      {profileRows.map((profile) => <article className="rounded-2xl border bg-white p-5" key={profile.id}><div className="flex flex-wrap justify-between gap-4">
        <div><div className="flex items-center gap-2"><h2 className="font-semibold">{profile.name}</h2><Badge variant="secondary">{profile.status}</Badge></div><p className="font-mono text-xs text-muted-foreground">{profile.key}</p><p className="mt-3 max-w-3xl text-sm">{profile.triggerDescription}</p><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{profile.recipientRelationship}</p></div>
        <div className="flex gap-2"><form action={reviewTransactionalProfileAction.bind(null, profile.id, "approved")}><Button size="sm">Approuver</Button></form><form action={reviewTransactionalProfileAction.bind(null, profile.id, "rejected")}><Button size="sm" variant="destructive">Refuser</Button></form><form action={disableTransactionalProfileAction.bind(null, profile.id)}><Button size="sm" variant="outline">Désactiver</Button></form></div>
      </div></article>)}
    </Section>

    <Section title="Templates">
      {templateRows.map((template) => <article className="rounded-2xl border bg-white p-5" key={template.id}><div className="flex flex-wrap justify-between gap-4">
        <div><h2 className="font-semibold">{template.name}</h2><p className="text-sm text-muted-foreground">{template.subject} · {template.reviewStatus}</p></div>
        <div className="flex gap-2"><form action={reviewTemplateAction.bind(null, template.id, "approved")}><Button size="sm">Approuver</Button></form><form action={reviewTemplateAction.bind(null, template.id, "rejected")}><Button size="sm" variant="destructive">Refuser</Button></form><form action={disableTemplateAction.bind(null, template.id)}><Button size="sm" variant="outline">Désactiver</Button></form></div>
      </div></article>)}
    </Section>

    <Section title="Comptes fournisseurs">
      {providerAccounts.map((account) => <article className="rounded-2xl border bg-white p-5" key={account.id}><div className="flex flex-wrap items-center justify-between gap-3">
        <p><strong>{account.provider}</strong> · {account.status} · workspace {account.workspaceId}</p>
        <div className="flex gap-2"><form action={setProviderAccountStatusAction.bind(null, account.id, account.status === "paused" ? "ready" : "paused")}><Button size="sm" variant="outline">{account.status === "paused" ? "Réactiver" : "Suspendre"}</Button></form><form action={setProviderAccountStatusAction.bind(null, account.id, "disabled")}><Button size="sm" variant="destructive">Désactiver</Button></form></div>
      </div></article>)}
    </Section>

    <Section title="Domaines et fournisseurs">
      {domainRows.map((domain) => {
        const domainBindings = bindings.filter((binding) => binding.domainId === domain.id);
        return <article className="rounded-2xl border bg-white p-5" key={domain.id}>
          <div className="flex flex-wrap justify-between gap-4">
            <div><h2 className="font-semibold">{domain.name}</h2><p className="text-sm text-muted-foreground">{domain.status}{domain.activeProvider ? ` · fournisseur actif ${domain.activeProvider}` : " · aucun fournisseur actif"}</p></div>
            <div className="flex gap-2"><form action={provisionDomainAction.bind(null, domain.id, "postmark")}><Button size="sm">Provisionner</Button></form><form action={provisionDomainAction.bind(null, domain.id, "ses")}><Button size="sm" variant="outline">Préparer SES</Button></form></div>
          </div>
          <div className="mt-4 grid gap-3">{domainBindings.map((binding) => <div className="rounded-xl border p-4 text-sm" key={binding.id}>
            <div className="flex flex-wrap items-center justify-between gap-3"><p><strong>{binding.provider}</strong> · {binding.status}{binding.isActive ? " · actif" : ""}</p><div className="flex gap-2">{binding.status === "verified" && !binding.isActive && <form action={activateDomainBindingAction.bind(null, binding.id)}><Button size="sm" variant="outline">Activer</Button></form>}{binding.status !== "disabled" && <form action={disableDomainBindingAction.bind(null, binding.id)}><Button size="sm" variant="destructive">Désactiver</Button></form>}</div></div>
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
