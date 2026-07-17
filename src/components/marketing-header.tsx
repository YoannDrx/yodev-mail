import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";

export function MarketingHeader() {
  return <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-xl"><div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5">
    <Link href="/" aria-label="VigieMail, accueil"><BrandMark /></Link>
    <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex"><Link href="/fonctionnalites">Fonctionnalités</Link><Link href="/delivrabilite">Délivrabilité</Link><Link href="/docs">API</Link><Link href="/tarifs">Tarifs</Link></nav>
    <div className="flex items-center gap-2"><Button asChild variant="ghost" className="hidden sm:inline-flex"><Link href="/connexion">Connexion</Link></Button><Button asChild><Link href="/inscription">Rejoindre la bêta</Link></Button></div>
  </div></header>;
}
