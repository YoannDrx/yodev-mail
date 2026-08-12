import { CreateOrganization } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { Check } from "lucide-react";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { completeOnboardingAction } from "@/features/onboarding/actions";
import { isClerkConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

const attestations = [
  ["noPurchasedLists", "Aucune liste achetée, louée ou scrapée."],
  ["noColdEmail", "Aucun cold email."],
  ["noNewsletter", "Aucune newsletter."],
  ["noMarketing", "Aucun message promotionnel."],
  ["noCircumvention", "Aucun contournement d’une suspension."],
  ["suspensionAccepted", "Yodev peut suspendre immédiatement un usage risqué."],
] as const;

export default async function Page() {
  if (isClerkConfigured()) {
    const session = await auth();
    if (!session.userId) redirect("/connexion");
    if (!session.orgId) return <main className="mx-auto grid min-h-screen max-w-3xl place-items-center p-6"><div className="grid w-full place-items-center gap-8"><BrandMark /><CreateOrganization afterCreateOrganizationUrl="/onboarding" /></div></main>;
  }
  return (
    <main className="mx-auto min-h-screen max-w-3xl p-6 py-12">
      <BrandMark />
      <section className="mt-10 rounded-3xl border bg-white p-8 shadow-xl">
        <p className="text-sm font-medium text-primary">DOSSIER DE BÊTA PRIVÉE</p>
        <h1 className="mt-2 text-3xl font-semibold">Décrivez précisément votre flux transactionnel.</h1>
        <p className="mt-3 text-muted-foreground">Un appel API doit correspondre à un événement applicatif et à un destinataire unique.</p>
        <form action={completeOnboardingAction} className="mt-8 grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2"><Field name="companyName" label="Identité légale" /><Field name="applicationName" label="Application concernée" /></div>
          <Field name="companyAddress" label="Adresse professionnelle" />
          <Field name="websiteUrl" label="Site public" type="url" />
          <div className="grid gap-2"><Label htmlFor="domainNames">Domaines ou sous-domaines d’envoi</Label><Textarea id="domainNames" name="domainNames" placeholder="notifications.client.fr" required /></div>
          <div className="grid gap-2"><Label htmlFor="categories">Catégories transactionnelles</Label><Textarea id="categories" name="categories" placeholder="Réinitialisation de mot de passe, reçu de paiement…" required /></div>
          <div className="grid gap-2"><Label htmlFor="triggerDescription">Événement déclencheur précis</Label><Textarea id="triggerDescription" name="triggerDescription" required /></div>
          <div className="grid gap-2"><Label htmlFor="recipientRelationship">Relation avec les destinataires</Label><Textarea id="recipientRelationship" name="recipientRelationship" required /></div>
          <div className="grid gap-4 sm:grid-cols-3"><Field name="expectedMonthlyVolume" label="Volume mensuel" type="number" /><Field name="averageDailyVolume" label="Moyenne quotidienne" type="number" /><Field name="dailyPeakVolume" label="Pic quotidien" type="number" /></div>
          <div className="grid gap-2"><Label htmlFor="exampleContent">Exemples de sujets et contenus</Label><Textarea id="exampleContent" name="exampleContent" required /></div>
          <div className="grid gap-2"><Label htmlFor="errorPolicy">Gestion des erreurs et destinataires invalides</Label><Textarea id="errorPolicy" name="errorPolicy" required /></div>
          <div className="grid gap-2 rounded-2xl border p-5">{attestations.map(([name, label]) => <label className="flex gap-3 text-sm" key={name}><input name={name} type="checkbox" required /><span>{label}</span></label>)}</div>
          <label className="flex gap-3 rounded-xl border p-4 text-sm"><input name="abuseAccepted" type="checkbox" required /><span><strong>J’accepte la politique anti-abus.</strong><br /><span className="text-muted-foreground">Le produit est strictement transactionnel.</span></span></label>
          <Button className="mt-2" type="submit">Envoyer pour validation <Check /></Button>
        </form>
      </section>
    </main>
  );
}

function Field({ name, label, type = "text" }: { name: string; label: string; type?: string }) {
  return <div className="grid gap-2"><Label htmlFor={name}>{label}</Label><Input id={name} min={type === "number" ? 1 : undefined} name={name} type={type} required /></div>;
}
