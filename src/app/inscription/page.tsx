import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { BetaApplicationForm } from "@/features/applications/beta-application-form";
import { localized, localizedPath } from "@/i18n/config";
import { getLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLocale()) === "fr" ? "Candidater à la bêta" : "Apply for the beta" };
}

export default async function Page() {
  const locale = await getLocale();
  const copy = localized(locale, {
    fr: { eyebrow: "BÊTA PRIVÉE", title: "L’accès se fait sur invitation.", text: "Chaque application, domaine et cas d’usage transactionnel est revu par Yodev avant l’envoi du premier message. Décrivez votre projet : nous répondons à chaque candidature par email.", scope: "Emails transactionnels uniquement : newsletters, prospection et campagnes ne sont pas acceptées.", invited: "J’ai déjà une invitation" },
    en: { eyebrow: "PRIVATE BETA", title: "Access is invitation-only.", text: "Every application, domain, and transactional use case is reviewed by Yodev before the first message is sent. Tell us about your project: we reply to every application by email.", scope: "Transactional emails only: newsletters, cold outreach and campaigns are not accepted.", invited: "I already have an invitation" },
  });
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="grid w-full max-w-2xl place-items-center gap-8">
        <Link href={localizedPath(locale, "/")}><BrandMark className="text-xl" /></Link>
        <div className="w-full rounded-md border bg-card p-6 sm:p-8">
          <p className="text-sm font-medium text-primary">{copy.eyebrow}</p>
          <h1 className="mt-2 text-3xl font-semibold">{copy.title}</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{copy.text}</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy.scope}</p>
          <div className="mt-6">
            <BetaApplicationForm locale={locale} />
          </div>
          <Button asChild className="mt-6 w-full" variant="outline"><Link href={localizedPath(locale, "/connexion")}>{copy.invited}</Link></Button>
        </div>
      </div>
    </main>
  );
}
