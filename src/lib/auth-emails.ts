import "server-only";

import { getSecureParameter } from "@/workers/runtime-secrets";
import { buildAuthEmailContent, type AuthEmailKind } from "@/i18n/auth-email";

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
  const content = buildAuthEmailContent(input);
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
      Subject: content.subject,
      HtmlBody: content.html,
      TextBody: content.text,
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
