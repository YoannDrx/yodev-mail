import "server-only";

import { getSecureParameter } from "@/workers/runtime-secrets";

type AuthEmailKind =
  | "email_verification"
  | "organization_invitation"
  | "password_reset"
  | "security_alert";

const subjects: Record<AuthEmailKind, string> = {
  email_verification: "Vérifiez votre adresse Mail by Yodev",
  organization_invitation: "Invitation à rejoindre Mail by Yodev",
  password_reset: "Réinitialisez votre mot de passe Mail by Yodev",
  security_alert: "Alerte de sécurité Mail by Yodev",
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

function systemTokenParameter() {
  if (process.env.POSTMARK_SYSTEM_SERVER_TOKEN_PARAMETER) {
    return process.env.POSTMARK_SYSTEM_SERVER_TOKEN_PARAMETER;
  }
  const environment = process.env.VERCEL_ENV === "production" ? "prod" : "dev";
  return `/yodev-mail-${environment}/providers/postmark/system/server-token`;
}

export async function sendAuthEmail(input: {
  kind: AuthEmailKind;
  to: string;
  actionUrl: string;
  intro: string;
}) {
  if (process.env.POSTMARK_ENABLED !== "true") {
    throw new Error("System authentication emails are not enabled.");
  }

  const token = await getSecureParameter(systemTokenParameter());
  const subject = subjects[input.kind];
  const intro = escapeHtml(input.intro);
  const actionUrl = escapeHtml(input.actionUrl);
  const response = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": token,
    },
    body: JSON.stringify({
      From: "Mail by Yodev <hello@yodev.fr>",
      To: input.to,
      Subject: subject,
      HtmlBody: `<p>${intro}</p><p><a href="${actionUrl}">Continuer dans Mail by Yodev</a></p><p>Ce lien est personnel et temporaire.</p>`,
      TextBody: `${input.intro}\n\n${input.actionUrl}\n\nCe lien est personnel et temporaire.`,
      MessageStream: "outbound",
      TrackOpens: false,
      TrackLinks: "None",
      Tag: input.kind,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    ErrorCode?: number;
  };
  if (!response.ok || payload.ErrorCode !== 0) {
    throw new Error("The authentication email provider rejected the request.");
  }
}
