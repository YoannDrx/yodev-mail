export type AuthEmailKind =
  | "email_verification"
  | "organization_invitation"
  | "password_reset"
  | "security_alert";

const subjects: Record<AuthEmailKind, string> = {
  email_verification: "Mail by Yodev - Vérification / Verification",
  organization_invitation: "Mail by Yodev - Invitation",
  password_reset: "Mail by Yodev - Mot de passe / Password",
  security_alert: "Mail by Yodev - Alerte / Alert",
};

const englishIntros: Record<AuthEmailKind, string> = {
  email_verification: "Confirm your email address before accessing your private workspace.",
  organization_invitation: "You have been invited to join a Mail by Yodev workspace.",
  password_reset: "A password reset was requested for your account.",
  security_alert: "A security event requires your attention.",
};

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[
        character
      ]!,
  );
}

export function buildAuthEmailContent(input: {
  actionUrl: string;
  intro: string;
  kind: AuthEmailKind;
}) {
  const intro = escapeHtml(input.intro);
  const englishIntro = escapeHtml(englishIntros[input.kind]);
  const actionUrl = escapeHtml(input.actionUrl);
  return {
    subject: subjects[input.kind],
    html: `<div lang="fr"><p>${intro}</p><p><a href="${actionUrl}">Continuer dans Mail by Yodev</a></p><p>Ce lien est personnel et temporaire.</p></div><hr><div lang="en"><p>${englishIntro}</p><p><a href="${actionUrl}">Continue to Mail by Yodev</a></p><p>This link is personal and temporary.</p></div>`,
    text: `${input.intro}\n\n${input.actionUrl}\n\nCe lien est personnel et temporaire.\n\n---\n\n${englishIntros[input.kind]}\n\n${input.actionUrl}\n\nThis link is personal and temporary.`,
  };
}
