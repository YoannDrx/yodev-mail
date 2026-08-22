import { Check } from "lucide-react";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { completeOnboardingAction } from "@/features/onboarding/actions";
import { localized, localizedPath } from "@/i18n/config";
import { getLocale } from "@/i18n/server";
import { currentWorkspace } from "@/lib/current-workspace";

export const dynamic = "force-dynamic";

export default async function Page() {
  const locale = await getLocale();
  const { workspace } = await currentWorkspace();
  if (workspace.status !== "sandbox") redirect(localizedPath(locale, "/dashboard"));
  const copy = localized(locale, {
    fr: {
      eyebrow: "DOSSIER DE BÊTA PRIVÉE", title: "Décrivez précisément votre flux transactionnel.", intro: "Un appel API doit correspondre à un événement applicatif et à un destinataire unique.",
      company: "Identité légale", application: "Application concernée", address: "Adresse professionnelle", website: "Site public", domains: "Domaines ou sous-domaines d’envoi", categories: "Catégories transactionnelles", categoriesPlaceholder: "Réinitialisation de mot de passe, reçu de paiement…", trigger: "Événement déclencheur précis", relationship: "Relation avec les destinataires", monthly: "Volume mensuel", daily: "Moyenne quotidienne", peak: "Pic quotidien", examples: "Exemples de sujets et contenus", errors: "Gestion des erreurs et destinataires invalides", abuse: "J’accepte la politique anti-abus.", strict: "Le produit est strictement transactionnel.", submit: "Envoyer pour validation",
      attestations: [["noPurchasedLists", "Aucune liste achetée, louée ou scrapée."], ["noColdEmail", "Aucun cold email."], ["noNewsletter", "Aucune newsletter."], ["noMarketing", "Aucun message promotionnel."], ["noCircumvention", "Aucun contournement d’une suspension."], ["suspensionAccepted", "Yodev peut suspendre immédiatement un usage risqué."]] as const,
    },
    en: {
      eyebrow: "PRIVATE BETA APPLICATION", title: "Describe your transactional flow precisely.", intro: "Each API call must map to one application event and one recipient.",
      company: "Legal identity", application: "Application", address: "Business address", website: "Public website", domains: "Sending domains or subdomains", categories: "Transactional categories", categoriesPlaceholder: "Password reset, payment receipt…", trigger: "Exact triggering event", relationship: "Relationship with recipients", monthly: "Monthly volume", daily: "Daily average", peak: "Daily peak", examples: "Example subjects and content", errors: "Error and invalid-recipient handling", abuse: "I accept the anti-abuse policy.", strict: "The product is strictly transactional.", submit: "Submit for review",
      attestations: [["noPurchasedLists", "No purchased, rented, or scraped lists."], ["noColdEmail", "No cold email."], ["noNewsletter", "No newsletters."], ["noMarketing", "No promotional messages."], ["noCircumvention", "No attempt to circumvent a suspension."], ["suspensionAccepted", "Yodev may immediately suspend risky usage."]] as const,
    },
  });
  return (
    <main className="mx-auto min-h-screen max-w-3xl p-6 py-12">
      <BrandMark />
      <section className="mt-10 rounded-3xl border bg-white p-8 shadow-xl">
        <p className="text-sm font-medium text-primary">{copy.eyebrow}</p>
        <h1 className="mt-2 text-3xl font-semibold">{copy.title}</h1>
        <p className="mt-3 text-muted-foreground">{copy.intro}</p>
        <form action={completeOnboardingAction} className="mt-8 grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2"><Field name="companyName" label={copy.company} /><Field name="applicationName" label={copy.application} /></div>
          <Field name="companyAddress" label={copy.address} />
          <Field name="websiteUrl" label={copy.website} type="url" />
          <div className="grid gap-2"><Label htmlFor="domainNames">{copy.domains}</Label><Textarea id="domainNames" name="domainNames" placeholder="notifications.client.com" required /></div>
          <div className="grid gap-2"><Label htmlFor="categories">{copy.categories}</Label><Textarea id="categories" name="categories" placeholder={copy.categoriesPlaceholder} required /></div>
          <div className="grid gap-2"><Label htmlFor="triggerDescription">{copy.trigger}</Label><Textarea id="triggerDescription" name="triggerDescription" required /></div>
          <div className="grid gap-2"><Label htmlFor="recipientRelationship">{copy.relationship}</Label><Textarea id="recipientRelationship" name="recipientRelationship" required /></div>
          <div className="grid gap-4 sm:grid-cols-3"><Field name="expectedMonthlyVolume" label={copy.monthly} type="number" /><Field name="averageDailyVolume" label={copy.daily} type="number" /><Field name="dailyPeakVolume" label={copy.peak} type="number" /></div>
          <div className="grid gap-2"><Label htmlFor="exampleContent">{copy.examples}</Label><Textarea id="exampleContent" name="exampleContent" required /></div>
          <div className="grid gap-2"><Label htmlFor="errorPolicy">{copy.errors}</Label><Textarea id="errorPolicy" name="errorPolicy" required /></div>
          <div className="grid gap-2 rounded-2xl border p-5">{copy.attestations.map(([name, label]) => <label className="flex gap-3 text-sm" key={name}><input name={name} type="checkbox" required /><span>{label}</span></label>)}</div>
          <label className="flex gap-3 rounded-xl border p-4 text-sm"><input name="abuseAccepted" type="checkbox" required /><span><strong>{copy.abuse}</strong><br /><span className="text-muted-foreground">{copy.strict}</span></span></label>
          <Button className="mt-2" type="submit">{copy.submit} <Check /></Button>
        </form>
      </section>
    </main>
  );
}

function Field({ name, label, type = "text" }: { name: string; label: string; type?: string }) {
  return <div className="grid gap-2"><Label htmlFor={name}>{label}</Label><Input id={name} min={type === "number" ? 1 : undefined} name={name} type={type} required /></div>;
}
