import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { localized, localizedPath } from "@/i18n/config";
import { getLocale } from "@/i18n/server";

export async function MarketingFooter() {
  const locale = await getLocale();
  const href = (pathname: string) => localizedPath(locale, pathname);
  const copy = localized(locale, {
    fr: { tagline: "La passerelle transactionnelle gérée pour les applications et domaines vérifiés.", product: "Produit", features: "Fonctionnalités", pricing: "Tarifs", trust: "Confiance", deliverability: "Délivrabilité", compliance: "Conformité", abuse: "Anti-abus", sla: "SLA bêta", legal: "Légal", privacy: "Confidentialité", terms: "CGU", processors: "Sous-traitants", notices: "Mentions légales", beta: "Bêta privée." },
    en: { tagline: "The managed transactional gateway for verified applications and domains.", product: "Product", features: "Features", pricing: "Pricing", trust: "Trust", deliverability: "Deliverability", compliance: "Compliance", abuse: "Anti-abuse", sla: "Beta SLA", legal: "Legal", privacy: "Privacy", terms: "Terms", processors: "Subprocessors", notices: "Legal notice", beta: "Private beta." },
  });
  return <footer className="border-t bg-white/60"><div className="mx-auto grid max-w-7xl gap-10 px-5 py-12 md:grid-cols-[1fr_2fr]">
    <div><BrandMark/><p className="mt-4 max-w-xs text-sm text-muted-foreground">{copy.tagline}</p></div>
    <div className="grid grid-cols-2 gap-6 text-sm sm:grid-cols-3"><div className="grid content-start gap-3"><strong>{copy.product}</strong><Link href={href("/fonctionnalites")}>{copy.features}</Link><Link href={href("/tarifs")}>{copy.pricing}</Link><Link href={href("/docs")}>Documentation</Link></div><div className="grid content-start gap-3"><strong>{copy.trust}</strong><Link href={href("/delivrabilite")}>{copy.deliverability}</Link><Link href={href("/conformite")}>{copy.compliance}</Link><Link href={href("/anti-abus")}>{copy.abuse}</Link><Link href={href("/sla")}>{copy.sla}</Link></div><div className="grid content-start gap-3"><strong>{copy.legal}</strong><Link href={href("/confidentialite")}>{copy.privacy}</Link><Link href={href("/cgu")}>{copy.terms}</Link><Link href={href("/dpa")}>DPA</Link><Link href={href("/sous-traitants")}>{copy.processors}</Link><Link href={href("/mentions-legales")}>{copy.notices}</Link></div></div>
  </div><div className="border-t py-5 text-center text-xs text-muted-foreground">© 2026 Mail by Yodev · {copy.beta}</div></footer>;
}
