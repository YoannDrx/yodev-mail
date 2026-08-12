import Link from "next/link";
import { SignUp } from "@clerk/nextjs";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { isClerkConfigured } from "@/lib/env";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const invited = typeof params.__clerk_ticket === "string" && params.__clerk_ticket.length > 20;
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="grid w-full max-w-md place-items-center gap-8">
        <Link href="/"><BrandMark className="text-xl" /></Link>
        {isClerkConfigured() && invited ? <SignUp /> : (
          <div className="w-full rounded-3xl border bg-white p-8">
            <p className="text-sm font-medium text-primary">BÊTA PRIVÉE</p>
            <h1 className="mt-2 text-3xl font-semibold">L’accès se fait sur dossier.</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">Chaque application, domaine et cas d’usage transactionnel est revu par Yodev avant l’envoi du premier message.</p>
            <Button asChild className="mt-6 w-full"><a href="mailto:hello@yodev.fr?subject=Candidature%20Mail%20by%20Yodev">Candidater à la bêta</a></Button>
            <Button asChild className="mt-3 w-full" variant="outline"><Link href="/connexion">J’ai déjà une invitation</Link></Button>
          </div>
        )}
      </div>
    </main>
  );
}
