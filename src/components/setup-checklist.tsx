import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Circle } from "lucide-react";
import type { ActivationEvidence } from "@/features/onboarding/activation";
import { localizedPath, type Locale } from "@/i18n/config";
import { statusLabel } from "@/i18n/format";

type Step = { id: string; title: string; ready: boolean; optional?: boolean; detail: string; path: string };

/** Setup evidence only; the sending policy remains the authority for each delivery. */
export function SetupChecklist({ locale, evidence, gates }: { locale: Locale; evidence: ActivationEvidence; gates: { liveSending: boolean; customerWebhooks: boolean } }) {
  const fr = locale === "fr";
  const subscribed = ["active", "trialing"].includes(evidence.billingStatus) || evidence.pilotActive;
  const steps: Step[] = [
    { id: "domain", title: fr ? "Domaine expéditeur" : "Sending domain", ready: evidence.domainVerified, detail: evidence.domainVerified ? (fr ? "Domaine vérifié" : "Verified domain") : (fr ? "Vérification DNS nécessaire" : "DNS verification required"), path: "/dashboard/domaines" },
    { id: "profile", title: fr ? "Cas d’usage" : "Use case", ready: evidence.profileApproved, detail: evidence.profileApproved ? (fr ? "Cas d’usage approuvé" : "Approved use case") : (fr ? "Déclaration et validation nécessaires" : "Declaration and approval required"), path: "/dashboard/profils" },
    { id: "test-key", title: fr ? "Clé API de test" : "Test API key", ready: evidence.testKey, detail: evidence.testKey ? (fr ? "Clé ym_test_ active" : "Active ym_test_ key") : (fr ? "Créez une clé de test (envois simulés)" : "Create a test key (simulated sends)"), path: "/dashboard/api-keys" },
    { id: "template", title: fr ? "Template et son ID" : "Template and its ID", ready: evidence.templateApproved, detail: evidence.templateApproved ? (fr ? "Template approuvé : son ID est prêt à copier" : "Approved template: its ID is ready to copy") : (fr ? "Créez un template et attendez sa validation" : "Create a template and wait for approval"), path: "/dashboard/templates" },
    { id: "simulated", title: fr ? "Premier envoi simulé" : "First simulated send", ready: evidence.simulatedSend, detail: evidence.simulatedSend ? (fr ? "Envoi de test accepté" : "Test send accepted") : (fr ? "Lancez l’appel d’exemple du template avec la clé de test" : "Run the template’s example call with the test key"), path: evidence.simulatedSend ? "/dashboard/emails" : "/dashboard/templates" },
    { id: "webhook", title: fr ? "Webhook (facultatif)" : "Webhook (optional)", optional: true, ready: evidence.webhook, detail: !gates.customerWebhooks ? (fr ? "La livraison des webhooks n’est pas encore ouverte" : "Webhook delivery is not open yet") : evidence.webhook ? (fr ? "Point de réception actif" : "Active endpoint") : (fr ? "Recevez les statuts de livraison" : "Receive delivery statuses"), path: "/dashboard/webhooks" },
    { id: "workspace", title: fr ? "Validation du workspace" : "Workspace approval", ready: evidence.workspaceStatus === "approved", detail: statusLabel(locale, evidence.workspaceStatus), path: "/dashboard/parametres" },
    { id: "billing", title: fr ? "Abonnement" : "Subscription", ready: subscribed, detail: evidence.pilotActive ? (fr ? "Accès pilote actif" : "Pilot access active") : statusLabel(locale, evidence.billingStatus), path: "/dashboard/facturation" },
    { id: "live-key", title: fr ? "Clé API live" : "Live API key", ready: evidence.liveKey, detail: evidence.liveKey ? (fr ? "Clé ym_live_ active" : "Active ym_live_ key") : !gates.liveSending ? (fr ? "Disponible à l’ouverture des envois live" : "Available once live sending opens") : evidence.workspaceStatus !== "approved" ? (fr ? "Disponible après la validation du workspace" : "Available after workspace approval") : (fr ? "Créez une clé live pour vos envois réels" : "Create a live key for real sends"), path: "/dashboard/api-keys" },
  ];
  const required = steps.filter((step) => !step.optional);
  const done = required.filter((step) => step.ready).length;
  return <section className="mt-6 border bg-card p-5" aria-labelledby="setup-title">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="setup-title" className="font-semibold">{fr ? "Préparer les premiers envois" : "Prepare your first sends"}</h2><p className="text-sm text-muted-foreground">{fr ? `${done} étape${done > 1 ? "s" : ""} sur ${required.length} terminée${done > 1 ? "s" : ""}` : `${done} of ${required.length} steps done`}</p></div>
    <p className="mt-1 text-sm text-muted-foreground">{fr ? "De la clé de test au premier envoi réel. Chaque envoi reste soumis aux vérifications du service." : "From the test key to the first real send. Each send remains subject to service checks."}</p>
    <ol className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{steps.map((step, index) => <li key={step.id}><Link href={localizedPath(locale, step.path)} className="flex h-full items-start gap-3 border p-3 text-sm hover:bg-muted">{step.ready ? <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--y-success)]" /> : <Circle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}<span className="flex-1"><strong className="block font-medium"><span className="text-muted-foreground">{index + 1}. </span>{step.title}</strong><span className="mt-1 block text-xs text-muted-foreground">{step.detail}</span><span className="sr-only">{step.ready ? (fr ? " (terminé)" : " (done)") : (fr ? " (à faire)" : " (to do)")}</span></span><ArrowUpRight aria-hidden="true" className="size-4 shrink-0" /></Link></li>)}</ol>
  </section>;
}
