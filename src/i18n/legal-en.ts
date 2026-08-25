import type { LegalPage } from "@/app/[legal]/page";

export const enLegalPages: Record<string, LegalPage> = {
  "anti-abus": {
    title: "Anti-abuse policy",
    intro: "Mail by Yodev is exclusively reserved for transactional messages expected by their recipient.",
    sections: [
      ["Permitted use", "A message must be triggered by a user action or documented business event, sent to one recipient, and attached to an approved transactional profile."],
      ["Prohibited use", "Campaigns, newsletters, advertising, cold outreach, scraping, purchased, rented, or exchanged lists, phishing, impersonation, unlawful content, and attempts to bypass a suspension are prohibited."],
      ["Controls", "Yodev reviews the identity, application, domain, use case, and templates. Quotas start at 50 emails per day and only increase after clean metrics have been observed."],
      ["Suspension", "Any complaint triggers a pause and manual review. A pause also occurs after three hard bounces, or a hard-bounce rate of at least 2% after 50 sends."],
      ["Reporting abuse", "Report abuse to abuse@yodev.fr with the relevant headers. Do not send passwords or unnecessary sensitive content."],
    ],
  },
  confidentialite: {
    title: "Privacy policy",
    intro: "Purposes, retention periods, and rights relating to Mail by Yodev.",
    sections: [
      ["Controller and processor", "Yodev, published by Yoann Andrieux, sole proprietor, controls account and administration data. For content and recipients submitted by a customer, Yodev acts as a processor under that customer’s documented instructions."],
      ["Data processed", "The service processes account data, domain settings, opaque identifiers, addresses required for delivery, templates, transactional content, temporary attachments, and sanitized technical events."],
      ["Purposes", "Data is used to authenticate users, verify domains, deliver messages, handle deliverability incidents, prevent abuse, bill usage, and meet legal obligations."],
      ["Retention", "Bodies are retained for no more than 30 days and attachments for no more than 24 hours. After 90 days, addresses and names linked to messages are replaced, clear-text suppression addresses are removed, and technical events are deleted. Contractual, billing, and audit data is retained for the periods required by applicable obligations."],
      ["Transfers", "Some subprocessors may process data outside the European Economic Area. Yodev relies on the transfer mechanisms declared by those providers, including Standard Contractual Clauses where applicable."],
      ["Rights and contact", "Requests for access, correction, deletion, restriction, or objection can be sent to support@yodev.fr. Complaints may be filed with the CNIL, the French data protection authority."],
    ],
  },
  cgu: {
    title: "Terms of use",
    intro: "Terms governing the Mail by Yodev private beta.",
    sections: [
      ["Access", "Access is personal, invitation-only, and subject to application approval. Customers protect their Yodev keys and revoke them immediately if compromise is suspected."],
      ["Service", "Mail by Yodev provides a transactional API. Yodev chooses the transport provider and may change it without altering the API contract, subject to the published subprocessor list."],
      ["Customer obligations", "The customer warrants the lawfulness of its processing, the accuracy of its application, a legitimate relationship with every recipient, and the strictly transactional nature of its content."],
      ["Price", "The beta costs €29 per month plus €0.0025 per email accepted by the delivery service. VAT is applied according to the tax regime in force at the time of invoicing. Simulations and requests rejected before acceptance are not billed."],
      ["Suspension and termination", "Yodev may immediately suspend a workspace, domain, profile, template, or access in the event of risk, complaint, non-payment, inaccurate information, or a breach of the anti-abuse policy."],
      ["Technical limits", "Idempotency prevents the same request from being repeated within Yodev. An ambiguous provider outcome is never retried automatically; exactly-once execution is not guaranteed."],
    ],
  },
  "mentions-legales": {
    title: "Legal notice",
    intro: "Information about the publisher of Mail by Yodev.",
    sections: [
      ["Publisher", "Mail by Yodev is published under the Yodev trade name by Yoann Andrieux, sole proprietor (EI)."],
      ["Registration and activity", "Yoann Andrieux EI is registered with the French National Business Register (RNE) and the Paris Trade and Companies Register (RCS) under SIREN 803 272 590. SIRET: 803 272 590 00024. Main activity: software programming (NAF/APE 62.01Z)."],
      ["VAT regime", "VAT not applicable under Article 293 B of the French General Tax Code."],
      ["Business address", "7 allée des Jonquilles, 95130 Franconville, France."],
      ["Publication director", "Yoann Andrieux."],
      ["Contact", "support@yodev.fr."],
      ["Hosting", "The application is hosted by Vercel Inc., 440 N Barranca Avenue #4133, Covina, CA 91723, United States. The application database is provided by Neon. Other subprocessors are listed on the dedicated page."],
    ],
  },
  dpa: {
    title: "Data Processing Agreement (DPA)",
    intro: "Terms governing the processing of personal data entrusted to Mail by Yodev.",
    sections: [
      ["Purpose and duration", "For the duration of the service and the stated retention periods, Yodev processes the data required to deliver transactional messages on behalf of the customer acting as controller."],
      ["Instructions", "Yodev acts only on documented instructions arising from the contract, workspace configuration, and lawful API requests, unless a contrary legal obligation applies and notification is permitted."],
      ["Confidentiality and security", "Access is restricted, secrets are encrypted, attachments are temporary and scanned, queues receive only opaque identifiers, and sensitive administrative operations are audited."],
      ["Subprocessors", "The customer authorizes the providers published in the subprocessor list. Material changes are notified within a reasonable period to allow a reasoned objection."],
      ["Assistance", "Yodev provides reasonable assistance with data-subject rights, security, data breaches, impact assessments, and authority requests, taking into account the nature of the processing."],
      ["End of service and audit", "At the end of the service, data is deleted according to the published periods unless retention is legally required. Yodev provides information reasonably necessary to demonstrate compliance, subject to confidentiality and proportionality."],
    ],
  },
  "sous-traitants": {
    title: "Subprocessor list",
    intro: "Providers that may process data to deliver Mail by Yodev.",
    sections: [
      ["Vercel", "Hosting for the web application and HTTP functions. US company; location and transfer mechanisms follow the applicable Vercel agreement."],
      ["Neon", "Managed PostgreSQL database configured in a European region for this service."],
      ["Google", "Optional OAuth sign-in provider for invited members. Other authentication and organization data is stored by Yodev with Better Auth."],
      ["Stripe", "Subscription, billing, payment, and customer portal. Payment data is processed directly by Stripe."],
      ["Amazon Web Services", "Queues, functions, temporary storage, encryption, malware protection, and, when enabled, transactional transport in the configured AWS region."],
      ["Postmark / ActiveCampaign", "Initial transactional transport, domain authentication, and delivery, bounce, and complaint events. Content retention is set to a maximum of 28 days when the contractual option is active."],
    ],
  },
  sla: {
    title: "Beta SLA and incidents",
    intro: "Service levels applicable during the private beta.",
    sections: [
      ["Beta scope", "The beta is a guided service with no financially guaranteed availability commitment. Yodev targets 99.5% monthly availability, excluding announced maintenance and external dependencies."],
      ["Priorities", "A critical incident prevents all acceptance or creates a security risk; a major incident degrades an essential function; a minor incident has an acceptable workaround."],
      ["Communication", "Critical incidents are prioritized and communicated to affected customers through the available channel. Support requests are sent to support@yodev.fr."],
      ["Security", "Suspected breaches, compromised keys, or abuse must be reported immediately. Yodev may suspend sending during the investigation and notify relevant parties as required."],
      ["Maintenance", "Planned maintenance is announced where possible. Domain changes are drained before switching and never trigger automatic failover for a message already submitted."],
    ],
  },
};
