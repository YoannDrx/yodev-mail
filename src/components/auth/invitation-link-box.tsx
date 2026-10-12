"use client";

import { CopyButton } from "@/components/copy-button";
import { localized, type Locale } from "@/i18n/config";
import { localeCode } from "@/i18n/format";

// Displays a freshly issued invitation link. It only exists in this client
// state: it is never rendered by the server, stored in the page or logged.
export function InvitationLinkBox({
  locale,
  link,
}: {
  locale: Locale;
  link: { url: string; expiresAt: string };
}) {
  const copy = localized(locale, {
    fr: { label: "Lien d’invitation", copy: "Copier le lien", copied: "Lien copié", expires: "Expire le" },
    en: { label: "Invitation link", copy: "Copy link", copied: "Link copied", expires: "Expires on" },
  });
  return (
    <div className="grid gap-2 rounded-md border border-dashed p-4 text-sm">
      <label className="grid gap-2 font-medium">
        {copy.label}
        <input
          className="h-9 w-full min-w-0 rounded-md border bg-muted px-3 font-mono text-xs"
          onFocus={(event) => event.currentTarget.select()}
          readOnly
          value={link.url}
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {copy.expires} {new Date(link.expiresAt).toLocaleString(localeCode(locale), { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}
        </span>
        <CopyButton copiedLabel={copy.copied} label={copy.copy} value={link.url} />
      </div>
    </div>
  );
}
