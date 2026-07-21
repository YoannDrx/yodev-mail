import { CreateOrganization } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { Check } from "lucide-react";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { completeOnboardingAction } from "@/features/onboarding/actions";
import { isClerkConfigured } from "@/lib/env";

export default async function Page() {
  if (isClerkConfigured()) {
    const session = await auth();
    if (!session.userId) redirect("/connexion");
    if (!session.orgId) {
      return (
        <main className="mx-auto grid min-h-screen max-w-3xl place-items-center p-6 py-12">
          <div className="grid w-full place-items-center gap-8">
            <BrandMark />
            <CreateOrganization afterCreateOrganizationUrl="/onboarding" />
          </div>
        </main>
      );
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl p-6 py-12">
      <BrandMark />
      <div className="mt-12">
        <div className="flex justify-between text-sm">
          <span>Créer votre workspace</span>
          <span className="text-muted-foreground">Étape 1 sur 3</span>
        </div>
        <Progress value={33} className="mt-3" />
      </div>
      <section className="mt-8 rounded-3xl border bg-white p-8 shadow-xl">
        <p className="text-sm font-medium text-primary">VOTRE ACTIVITÉ</p>
        <h1 className="mt-2 text-3xl font-semibold">Commençons par vous connaître.</h1>
        <p className="mt-3 text-muted-foreground">
          Ces informations servent à la validation anti-abus du workspace.
        </p>
        <form action={completeOnboardingAction} className="mt-8 grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="companyName">Raison sociale</Label>
            <Input id="companyName" name="companyName" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="companyAddress">Adresse postale</Label>
            <Input id="companyAddress" name="companyAddress" required />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="websiteUrl">Site public</Label>
              <Input id="websiteUrl" name="websiteUrl" type="url" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="expectedMonthlyVolume">Volume mensuel attendu</Label>
              <Input id="expectedMonthlyVolume" name="expectedMonthlyVolume" type="number" min="0" required />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="useCase">Quels emails allez-vous envoyer ?</Label>
            <Textarea id="useCase" name="useCase" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="source">Comment les destinataires ont-ils été collectés ?</Label>
            <Textarea id="source" name="source" required />
          </div>
          <label className="flex gap-3 rounded-xl border p-4 text-sm">
            <input name="abuseAccepted" type="checkbox" required />
            <span>
              <strong>J’accepte la politique anti-abus.</strong>
              <br />
              <span className="text-muted-foreground">
                Pas de cold email, scraping ou liste achetée.
              </span>
            </span>
          </label>
          <Button className="mt-2" type="submit">
            Envoyer pour validation <Check />
          </Button>
        </form>
      </section>
    </main>
  );
}
