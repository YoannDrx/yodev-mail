import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { SignInProblem } from "@/lib/auth-policy";
import { siteConfig } from "@/lib/site-config";
import { localized, localizedPath, type Locale } from "@/i18n/config";

type Copy = { title: string; text: string };

const messages: Record<SignInProblem, Record<Locale, Copy>> = {
  invitation_required: {
    fr: { title: "Invitation requise", text: "Aucune invitation en attente ne correspond à ce compte Google. L’accès à Yodev Mail se fait uniquement sur invitation : reconnectez-vous avec l’adresse exacte qui a reçu l’invitation, ou déposez une candidature." },
    en: { title: "Invitation required", text: "No pending invitation matches this Google account. Access to Yodev Mail is by invitation only: sign in again with the exact address that received the invitation, or apply for access." },
  },
  session_expired: {
    fr: { title: "Session de connexion expirée", text: "La connexion a pris trop de temps ou a été lancée depuis un autre onglet ou une autre adresse. Relancez simplement la connexion." },
    en: { title: "Sign-in session expired", text: "Signing in took too long or was started from another tab or address. Simply start signing in again." },
  },
  account_not_linked: {
    fr: { title: "Compte non lié à Google", text: "Un compte existe déjà pour cette adresse, mais il n’est pas lié à Google. Connectez-vous avec la méthode utilisée jusqu’ici (passkey ou email), ou contactez le support." },
    en: { title: "Account not linked to Google", text: "An account already exists for this address but is not linked to Google. Sign in with the method you used so far (passkey or email), or contact support." },
  },
  cancelled: {
    fr: { title: "Connexion annulée", text: "La connexion a été annulée sur la page Google. Vous pouvez réessayer quand vous le souhaitez." },
    en: { title: "Sign-in cancelled", text: "Sign-in was cancelled on the Google page. You can try again whenever you like." },
  },
  bootstrap_ambiguous: {
    fr: { title: "Compte administrateur à rattacher", text: "La connexion a réussi, mais plusieurs workspaces existent déjà : le compte administrateur ne peut pas être rattaché automatiquement à l’un d’eux, et rien n’a été modifié. Un opérateur doit l’ajouter comme membre du workspace voulu, puis vous pourrez vous reconnecter." },
    en: { title: "Administrator account must be attached", text: "Sign-in succeeded, but several workspaces already exist: the administrator account cannot be attached to one of them automatically, and nothing was changed. An operator must add it as a member of the intended workspace, then you can sign in again." },
  },
  generic: {
    fr: { title: "La connexion n’a pas abouti", text: "Réessayez. Si le problème persiste, vérifiez que vous utilisez l’adresse invitée." },
    en: { title: "Sign-in did not complete", text: "Please try again. If the problem persists, check that you are using the invited address." },
  },
};

export function SignInProblemNotice({
  locale,
  problem,
  children,
}: {
  locale: Locale;
  problem: SignInProblem;
  children?: React.ReactNode;
}) {
  const copy = messages[problem][locale];
  const links = localized(locale, {
    fr: { apply: "Déposer une candidature", support: "Contacter le support" },
    en: { apply: "Apply for access", support: "Contact support" },
  });
  return (
    <div className="w-full rounded-md border border-destructive/40 bg-card p-5 text-sm" role="alert">
      <p className="flex items-center gap-2 font-semibold text-destructive">
        <AlertTriangle aria-hidden className="size-4 shrink-0" />
        {copy.title}
      </p>
      <p className="mt-2 leading-6 text-muted-foreground">{copy.text}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {problem === "invitation_required" ? (
          <Link className="font-medium text-primary underline-offset-4 hover:underline" href={localizedPath(locale, "/inscription")}>
            {links.apply}
          </Link>
        ) : null}
        {problem === "account_not_linked" || problem === "bootstrap_ambiguous" || problem === "generic" ? (
          <a className="font-medium text-primary underline-offset-4 hover:underline" href={`mailto:${siteConfig.supportEmail}`}>
            {links.support}
          </a>
        ) : null}
        {children}
      </div>
    </div>
  );
}
