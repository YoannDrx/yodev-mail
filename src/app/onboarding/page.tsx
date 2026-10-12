import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { AccountMenu } from "@/components/auth/account-menu";
import { SignOutButton } from "@/components/sign-out-button";
import { OnboardingForm } from "@/features/onboarding/onboarding-form";
import { localized, localizedPath } from "@/i18n/config";
import { getLocale } from "@/i18n/server";
import { currentWorkspace, WorkspaceAccessError } from "@/lib/current-workspace";
import { requirePageUser } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: localized(locale, { fr: "Dossier de bêta privée", en: "Private beta application" }) };
}

export default async function Page() {
  const locale = await getLocale();
  await requirePageUser();
  let context;
  try {
    context = await currentWorkspace();
  } catch (error) {
    if (!(error instanceof WorkspaceAccessError)) throw error;
    const accessCopy = localized(locale, {
      fr: { title: "Aucun workspace accessible", text: "Votre compte est connecté, mais vous n’avez pas accès au workspace demandé. Choisissez un autre workspace, acceptez le lien d’invitation reçu ou contactez son propriétaire." },
      en: { title: "No accessible workspace", text: "You are signed in, but cannot access the requested workspace. Choose another workspace, open your invitation link, or contact its owner." },
    });
    return <main className="mx-auto min-h-screen max-w-3xl p-6 py-12">
      <div className="flex flex-wrap items-center justify-between gap-4"><BrandMark /><AccountMenu locale={locale} /></div>
      <section className="mt-10 rounded-md border bg-card p-8 ">
        <h1 className="text-3xl font-semibold">{accessCopy.title}</h1>
        <p className="mt-3 text-muted-foreground">{accessCopy.text}</p>
      </section>
    </main>;
  }
  const { workspace } = context;
  if (workspace.status !== "sandbox") redirect(localizedPath(locale, "/dashboard"));
  const copy = localized(locale, {
    fr: { eyebrow: "DOSSIER DE BÊTA PRIVÉE", title: "Décrivez précisément votre flux transactionnel.", intro: "Un appel API doit correspondre à un événement applicatif et à un destinataire unique.", required: "Tous les champs sont obligatoires. En cas d’erreur, votre saisie est conservée." },
    en: { eyebrow: "PRIVATE BETA APPLICATION", title: "Describe your transactional flow precisely.", intro: "Each API call must map to one application event and one recipient.", required: "All fields are required. If something is wrong, your input is kept." },
  });
  return (
    <main className="mx-auto min-h-screen max-w-3xl p-6 py-12">
      <div className="flex flex-wrap items-center justify-between gap-4"><BrandMark /><SignOutButton locale={locale} /></div>
      <section className="mt-10 rounded-md border bg-card p-8 ">
        <p className="text-sm font-medium text-primary">{copy.eyebrow}</p>
        <h1 className="mt-2 text-3xl font-semibold">{copy.title}</h1>
        <p className="mt-3 text-muted-foreground">{copy.intro}</p>
        <p className="mt-2 text-sm text-muted-foreground">{copy.required}</p>
        <OnboardingForm locale={locale} />
      </section>
    </main>
  );
}
