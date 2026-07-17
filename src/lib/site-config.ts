export const siteConfig = {
  name: "VigieMail",
  title: "VigieMail — Tous vos emails. Zéro angle mort.",
  description:
    "La plateforme française pour envoyer campagnes et emails transactionnels depuis vos domaines, avec conformité, délivrabilité et coûts transparents.",
  marketingUrl: process.env.NEXT_PUBLIC_MARKETING_URL ?? "http://localhost:3000",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  supportEmail: "support@vigie-mail.fr",
} as const;

