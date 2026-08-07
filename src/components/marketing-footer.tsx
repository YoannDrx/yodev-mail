import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

export function MarketingFooter() {
  return <footer className="border-t bg-white/60"><div className="mx-auto grid max-w-7xl gap-10 px-5 py-12 md:grid-cols-[1fr_2fr]">
    <div><BrandMark/><p className="mt-4 max-w-xs text-sm text-muted-foreground">L'infrastructure email française qui garde chaque projet sous contrôle.</p></div>
    <div className="grid grid-cols-2 gap-6 text-sm sm:grid-cols-3"><div className="grid content-start gap-3"><strong>Produit</strong><Link href="/fonctionnalites">Fonctionnalités</Link><Link href="/tarifs">Tarifs</Link><Link href="/docs">Documentation</Link></div><div className="grid content-start gap-3"><strong>Confiance</strong><Link href="/delivrabilite">Délivrabilité</Link><Link href="/conformite">Conformité</Link><Link href="/anti-abus">Anti-abus</Link></div><div className="grid content-start gap-3"><strong>Légal</strong><Link href="/confidentialite">Confidentialité</Link><Link href="/cgu">CGU</Link><Link href="/mentions-legales">Mentions légales</Link></div></div>
  </div><div className="border-t py-5 text-center text-xs text-muted-foreground">© 2026 Mail by Yodev. Hébergé en Europe.</div></footer>;
}
