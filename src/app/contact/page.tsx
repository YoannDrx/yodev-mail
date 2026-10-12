import type { Metadata } from "next";
import { LifeBuoy, Mail, ShieldAlert, ShieldCheck } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { localized } from "@/i18n/config";
import { getLocale } from "@/i18n/server";
import { publicPageMetadata } from "@/lib/public-metadata";
import { siteConfig } from "@/lib/site-config";

const securityReportUrl = "https://github.com/YoannDrx/yodev-mail/security/advisories/new";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return publicPageMetadata(locale, "/contact", {
    title: localized(locale, { fr: "Contact et support", en: "Contact and support" }),
    description: localized(locale, {
      fr: "Joindre l’équipe Mail by Yodev : support technique, candidature à la bêta, signalement d’abus et de vulnérabilité.",
      en: "Reach the Mail by Yodev team: technical support, beta applications, abuse and vulnerability reports.",
    }),
  });
}

export default async function ContactPage() {
  const locale = await getLocale();
  const copy = localized(locale, {
    fr: {
      eyebrow: "Contact et support",
      title: "Écrivez-nous, une personne vous répond.",
      intro: "Écrivez à l’adresse qui correspond à votre demande. N’envoyez jamais de clé API, de mot de passe ni de contenu de message.",
      cards: [
        { icon: LifeBuoy, title: "Support", text: "Clients et membres : intégration de l’API, domaines, facturation, demandes relatives à vos données personnelles.", email: siteConfig.supportEmail },
        { icon: Mail, title: "Bêta et commercial", text: "Questions avant candidature, cas d’usage, volumes attendus et conditions de la bêta privée.", email: siteConfig.salesEmail },
        { icon: ShieldAlert, title: "Signaler un abus", text: "Message non sollicité ou usurpation envoyé via Mail by Yodev : joignez les en-têtes complets.", email: siteConfig.abuseEmail },
      ],
      security: "Vulnérabilité de sécurité",
      securityText: "Utilisez le signalement privé GitHub plutôt qu’un email ou une issue publique.",
      securityLink: "Signaler une vulnérabilité",
      delay: "Les demandes reçoivent une réponse par email, en français ou en anglais.",
    },
    en: {
      eyebrow: "Contact and support",
      title: "Write to us and a person will reply.",
      intro: "Write to the address that matches your request. Never send an API key, a password, or message content.",
      cards: [
        { icon: LifeBuoy, title: "Support", text: "Customers and members: API integration, domains, billing, and requests about your personal data.", email: siteConfig.supportEmail },
        { icon: Mail, title: "Beta and sales", text: "Questions before applying, use cases, expected volumes, and private beta terms.", email: siteConfig.salesEmail },
        { icon: ShieldAlert, title: "Report abuse", text: "Unsolicited or impersonating email sent through Mail by Yodev: include the full headers.", email: siteConfig.abuseEmail },
      ],
      security: "Security vulnerability",
      securityText: "Use GitHub private vulnerability reporting rather than email or a public issue.",
      securityLink: "Report a vulnerability",
      delay: "Requests are answered by email, in French or English.",
    },
  });
  return <PageShell eyebrow={copy.eyebrow} title={copy.title} intro={copy.intro}>
    <div className="grid gap-5 md:grid-cols-3">{copy.cards.map(({ icon: Icon, title, text, email }) => <article key={email} className="rounded-md border bg-card p-7">
      <Icon aria-hidden="true" className="size-6 text-primary"/>
      <h2 className="mt-5 text-xl font-semibold">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{text}</p>
      <p className="mt-5"><a className="font-medium text-primary underline underline-offset-4" href={`mailto:${email}`}>{email}</a></p>
    </article>)}</div>
    <section className="mt-6 rounded-md border bg-card p-7"><ShieldCheck aria-hidden="true" className="size-6 text-primary"/><h2 className="mt-5 text-xl font-semibold">{copy.security}</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">{copy.securityText}</p><p className="mt-5"><a className="font-medium text-primary underline underline-offset-4" href={securityReportUrl} rel="noreferrer">{copy.securityLink}</a></p></section>
    <p className="mt-8 text-center text-sm text-muted-foreground">{copy.delay}</p>
  </PageShell>;
}
