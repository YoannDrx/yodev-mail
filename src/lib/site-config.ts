export const siteConfig = {
  name: "Mail by Yodev",
  title: "Mail by Yodev — Passerelle email transactionnelle gérée",
  description:
    "Une API transactionnelle opérée par Yodev pour des applications, domaines et cas d’usage vérifiés.",
  marketingUrl: process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://yodev.fr/fr/mail",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://mail.yodev.fr",
  apiUrl: "https://api.mail.yodev.fr",
  supportEmail: "support@mail.yodev.fr",
} as const;
