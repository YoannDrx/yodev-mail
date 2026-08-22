import type { Locale } from "@/i18n/config";

const statusLabels: Record<string, Record<Locale, string>> = {
  accepted: { fr: "accepté", en: "accepted" },
  active: { fr: "actif", en: "active" },
  approved: { fr: "approuvé", en: "approved" },
  complained: { fr: "plainte", en: "complained" },
  delivered: { fr: "délivré", en: "delivered" },
  disabled: { fr: "désactivé", en: "disabled" },
  email_failed: { fr: "email échoué", en: "email failed" },
  failed: { fr: "échoué", en: "failed" },
  hard_bounced: { fr: "hard bounce", en: "hard bounced" },
  inactive: { fr: "inactif", en: "inactive" },
  invitation_sent: { fr: "invitation envoyée", en: "invitation sent" },
  limited: { fr: "limité", en: "limited" },
  live: { fr: "live", en: "live" },
  paused: { fr: "suspendu", en: "paused" },
  pending: { fr: "en attente", en: "pending" },
  pending_email: { fr: "email en attente", en: "email pending" },
  pending_review: { fr: "en revue", en: "under review" },
  queued: { fr: "en file", en: "queued" },
  ready: { fr: "prêt", en: "ready" },
  rejected: { fr: "refusé", en: "rejected" },
  sending: { fr: "en cours d’envoi", en: "sending" },
  sending_email: { fr: "email en cours d’envoi", en: "sending email" },
  sent: { fr: "envoyé", en: "sent" },
  simulated: { fr: "simulé", en: "simulated" },
  soft_bounced: { fr: "soft bounce", en: "soft bounced" },
  suppressed: { fr: "supprimé", en: "suppressed" },
  test: { fr: "test", en: "test" },
  unknown: { fr: "inconnu", en: "unknown" },
  verified: { fr: "vérifié", en: "verified" },
  hybrid: { fr: "hybride", en: "hybrid" },
  template_only: { fr: "templates uniquement", en: "templates only" },
};

export function localeCode(locale: Locale) {
  return locale === "fr" ? "fr-FR" : "en-US";
}

export function statusLabel(locale: Locale, status: string) {
  return statusLabels[status]?.[locale] ?? status.replaceAll("_", " ");
}
