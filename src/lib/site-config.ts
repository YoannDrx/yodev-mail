export const siteConfig = {
  name: "Mail by Yodev",
  title: "Mail by Yodev — Tous vos emails. Zéro angle mort.",
  description:
    "La plateforme française pour envoyer campagnes et emails transactionnels depuis vos domaines, avec conformité, délivrabilité et coûts transparents.",
  marketingUrl: process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://yodev.fr/fr/mail",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://mail.yodev.fr",
  apiUrl: "https://api.mail.yodev.fr",
  linksUrl: process.env.PUBLIC_LINKS_URL ?? "https://links.mail.yodev.fr",
  supportEmail: "hello@yodev.fr",
} as const;
