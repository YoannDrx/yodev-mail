import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { localized, localizedPath } from "@/i18n/config";
import { getLocale } from "@/i18n/server";

export default async function Page() {
  const locale = await getLocale();
  const copy = localized(locale, {
    fr: { eyebrow: "BÊTA PRIVÉE", title: "L’accès se fait sur invitation.", text: "Chaque application, domaine et cas d’usage transactionnel est revu par Yodev avant l’envoi du premier message.", apply: "Candidater à la bêta", invited: "J’ai déjà une invitation", subject: "Candidature Mail by Yodev" },
    en: { eyebrow: "PRIVATE BETA", title: "Access is invitation-only.", text: "Every application, domain, and transactional use case is reviewed by Yodev before the first message is sent.", apply: "Apply for the beta", invited: "I already have an invitation", subject: "Mail by Yodev application" },
  });
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="grid w-full max-w-md place-items-center gap-8">
        <Link href={localizedPath(locale, "/")}><BrandMark className="text-xl" /></Link>
        <div className="w-full rounded-3xl border bg-white p-8">
          <p className="text-sm font-medium text-primary">{copy.eyebrow}</p>
          <h1 className="mt-2 text-3xl font-semibold">{copy.title}</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{copy.text}</p>
          <Button asChild className="mt-6 w-full"><a href={`mailto:hello@yodev.fr?subject=${encodeURIComponent(copy.subject)}`}>{copy.apply}</a></Button>
          <Button asChild className="mt-3 w-full" variant="outline"><Link href={localizedPath(locale, "/connexion")}>{copy.invited}</Link></Button>
        </div>
      </div>
    </main>
  );
}
