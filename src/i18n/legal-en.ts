import type { LegalFacts, LegalPage } from "@/lib/legal";

export function enLegalPages({ plan, vat, support, abuse }: LegalFacts): Record<string, LegalPage> {
  return {
    "anti-abus": {
      title: "Anti-abuse policy",
      intro: "Mail by Yodev is exclusively reserved for transactional messages expected by their recipient.",
      sections: [
        ["Permitted use", "A message must be triggered by a user action or documented business event, sent to one recipient, and attached to an approved transactional profile."],
        ["Prohibited use", "Campaigns, newsletters, advertising, cold outreach, scraping, purchased, rented, or exchanged lists, phishing, impersonation, unlawful content, and attempts to bypass a suspension are prohibited."],
        ["Controls", `Yodev reviews the identity, application, domain, use case, and templates. Quotas start at ${plan.dailyLimit} emails per day and only increase after clean metrics have been observed.`],
        ["Suspension", "Any complaint triggers a pause and manual review. A pause also occurs after three hard bounces, or a hard-bounce rate of at least 2% after 50 sends."],
        ["Reporting abuse", `Report abuse to ${abuse} with the relevant headers. Do not send passwords or unnecessary sensitive content.`],
      ],
    },
    confidentialite: {
      title: "Privacy policy",
      intro: "Data processed, purposes, legal bases, retention periods, cookies, and rights relating to Mail by Yodev.",
      sections: [
        ["Controller and processor", `Yodev, published by Yoann Andrieux, sole proprietor, controls account, administration, and billing data. For content and recipients submitted by a customer, Yodev acts as a processor under that customer’s documented instructions (see the DPA). Contact: ${support}.`],
        ["Data processed", [
          "Accounts and members: name, email address, profile picture provided by Google where applicable, workspace role, passkey public keys.",
          "Sessions: IP address and browser associated with each sign-in session.",
          "Workspace and billing: company name, domains, settings, subscription, and Stripe identifiers. Card data is processed directly by Stripe.",
          "Security: log of administrative decisions and rate-limit counters.",
          "On behalf of customers: sender and recipient addresses and names, transactional content, temporary attachments, and sanitized technical events.",
        ]],
        ["Purposes and legal bases", [
          "Creating and managing accounts, authenticating members, providing the API and console: performance of the contract (GDPR Art. 6(1)(b)).",
          "Securing the service, preventing abuse, and protecting sending reputation: legitimate interest of Yodev, its customers, and recipients (Art. 6(1)(f)).",
          "Billing usage and keeping accounts: performance of the contract and legal obligation (Art. 6(1)(b) and 6(1)(c)).",
          "Answering support requests and reports: performance of the contract or legitimate interest.",
          "Delivering customers’ messages: processing carried out as a processor; the legal basis is determined by the customer acting as controller.",
        ]],
        ["Retention periods", [
          "Message bodies: 30 days at most.",
          "Attachments: 24 hours at most.",
          "Addresses and names linked to messages: replaced after 90 days; technical events: deleted after 90 days.",
          "Suppressions (bounces, complaints): the clear-text address is removed after 90 days; only a non-reversible fingerprint is kept to prevent another send.",
          "Sign-in sessions: 7 days, extended on use; verification and reset links: 15 minutes.",
          "Account and workspace data: for as long as the service is used, then deleted on request, subject to the obligations below.",
          "Invoices and accounting records: 10 years (Article L123-22 of the French Commercial Code).",
        ]],
        ["Cookies and local storage", [
          "Session cookie prefixed “yodev_mail.” (with the __Secure- prefix over HTTPS): keeps you signed in for up to 7 days. Strictly necessary.",
          "Temporary authentication cookies prefixed “yodev_mail.” during a Google or passkey sign-in: protect the flow and expire within minutes. Strictly necessary.",
          "“yodev_mail_locale” cookie: remembers the chosen language for 12 months.",
          "Theme preference: saved in the browser’s local storage (“theme” key), never sent to the server.",
          "No audience measurement, advertising, or third-party tracking cookie is set. Because these items are strictly necessary or store a preference the user asked for, no consent is required and no banner is shown. Google sign-in and Stripe payment pages apply their own policies.",
        ]],
        ["Recipients and transfers", "Data is accessible to Yodev and to the providers listed on the subprocessor page, together with their location. Some are established in the United States; any transfer outside the European Economic Area is governed by those providers’ data processing agreements."],
        ["Your rights", `You may request access, correction, deletion, restriction, or portability of your data, or object to processing based on legitimate interest, by writing to ${support}. Requests are answered within one month. For messages sent by a customer, contact that customer first; Yodev forwards your request to them. You may lodge a complaint with the CNIL, the French data protection authority.`],
      ],
    },
    cgu: {
      title: "Terms of use",
      intro: "Terms of use and financial conditions of the Mail by Yodev private beta.",
      sections: [
        ["Customers", "The service is intended for businesses using it for their professional activity. Access is personal, invitation-only, and subject to application approval. Customers protect their Yodev keys and revoke them immediately if compromise is suspected."],
        ["Service", "Mail by Yodev provides a transactional API. Yodev chooses the transport provider and may change it without altering the API contract, subject to the published subprocessor list. Capabilities announced as “coming soon” are neither provided nor billed."],
        ["Customer obligations", "The customer warrants the lawfulness of its processing, the accuracy of its application, a legitimate relationship with every recipient, and the strictly transactional nature of its content."],
        ["Price", `The beta costs ${plan.monthly} per month plus ${plan.perEmail} per email accepted by the delivery service. ${vat} Simulations and requests rejected before acceptance are not billed.`],
        ["Invoicing and payment", "Invoices are issued through Stripe and are payable upon receipt using the registered payment method. No discount is granted for early payment."],
        ["Late payment", "Any late payment automatically triggers, from the day after the due date, late-payment penalties at the European Central Bank’s most recent refinancing rate plus 10 percentage points, together with a fixed recovery indemnity of €40 (Articles L441-10 and D441-5 of the French Commercial Code). Additional compensation may be claimed on proof when recovery costs exceed that amount. The service may be suspended after an unanswered reminder."],
        ["Suspension and termination", "Yodev may immediately suspend a workspace, domain, profile, template, or access in the event of risk, complaint, non-payment, inaccurate information, or a breach of the anti-abuse policy."],
        ["Technical limits", "Idempotency prevents the same request from being repeated within Yodev. An ambiguous provider outcome is never retried automatically; exactly-once execution is not guaranteed."],
      ],
    },
    "mentions-legales": {
      title: "Legal notice",
      intro: "Information about the publisher and host of Mail by Yodev.",
      sections: [
        ["Publisher", "Mail by Yodev is published under the Yodev trade name by Yoann Andrieux, sole proprietor (EI)."],
        ["Registration and activity", "Yoann Andrieux EI is registered with the French National Business Register (RNE) and the Paris Trade and Companies Register (RCS) under SIREN 803 272 590. SIRET: 803 272 590 00024. Main activity: software programming (NAF/APE 62.01Z)."],
        ["VAT regime", vat],
        ["Business address", "7 allée des Jonquilles, 95130 Franconville, France."],
        ["Publication director", "Yoann Andrieux."],
        ["Contact", `${support}.`],
        ["Hosting", "The application is hosted by Vercel Inc., 440 N Barranca Avenue #4133, Covina, CA 91723, United States; its functions run in the Frankfurt region (Germany). The application database is provided by Neon in the AWS eu-central-1 region (Frankfurt). Other subprocessors are listed on the dedicated page."],
      ],
    },
    dpa: {
      title: "Data Processing Agreement (DPA)",
      intro: "Terms governing the processing of personal data entrusted to Mail by Yodev (GDPR Article 28).",
      sections: [
        ["Purpose and duration", "For the duration of the service and the stated retention periods, Yodev processes the data required to deliver transactional messages on behalf of the customer acting as controller."],
        ["Nature and purpose", "API intake, validation, queuing, hand-off to the delivery service, tracking of delivery, bounce, and complaint events, suppression management, and abuse prevention."],
        ["Data subjects", [
          "Recipients of the customer’s transactional messages (its users, customers, or partners).",
          "People designated by the customer as sender or reply-to address.",
          "Members of the customer’s workspace who use the console.",
        ]],
        ["Categories of data", [
          "Email addresses and names of senders, recipients, and reply-to addresses.",
          "Message content: subject, body, template variables, and temporary attachments.",
          "Technical metadata: identifiers, customer-provided reference, timestamps, statuses, bounce and complaint codes, suppression fingerprints.",
          "The service is not designed for special categories of data (GDPR Article 9); the customer refrains from placing them in content.",
        ]],
        ["Instructions", "Yodev acts only on documented instructions arising from the contract, workspace configuration, and lawful API requests, unless a contrary legal obligation applies and notification is permitted."],
        ["Confidentiality and security", "Authorized personnel are bound by confidentiality. Access is restricted, secrets are encrypted, attachments are temporary and scanned, queues receive only opaque identifiers, and sensitive administrative operations are audited."],
        ["Retention", "Message bodies: 30 days at most. Attachments: 24 hours at most. After 90 days, addresses and names linked to messages are replaced, clear-text suppression addresses are removed, and technical events are deleted."],
        ["Subprocessors", "The customer authorizes the providers published in the subprocessor list. Material changes are notified within a reasonable period to allow a reasoned objection."],
        ["Personal data breaches", `Yodev notifies the customer of any personal data breach affecting it without undue delay and no later than 48 hours after becoming aware of it, at the workspace owner’s address. The notification describes, as far as known, the nature of the breach, the categories and approximate number of data subjects and records concerned, the likely consequences, and the measures taken or proposed. It is supplemented as information becomes available. The point of contact is ${support}.`],
        ["Assistance", "Yodev provides reasonable assistance with data-subject rights, security, data breaches, impact assessments, and authority requests, taking into account the nature of the processing."],
        ["End of service and audit", "At the end of the service, data is deleted according to the published periods unless retention is legally required. Yodev provides information reasonably necessary to demonstrate compliance, subject to confidentiality and proportionality."],
      ],
    },
    "sous-traitants": {
      title: "Subprocessor list",
      intro: "Providers that may process data to deliver Mail by Yodev, with their location.",
      sections: [
        ["Vercel", "Hosting for the web application and HTTP functions. Company established in the United States; functions run in the Frankfurt region (Germany, fra1) and pages travel through its delivery network. Any transfer is governed by Vercel’s data processing agreement."],
        ["Neon", "Managed PostgreSQL database hosted in the AWS eu-central-1 region (Frankfurt, Germany). Any support-related transfer is governed by Neon’s data processing agreement."],
        ["Amazon Web Services", "Queues, functions, temporary attachment storage, encryption, malware scanning, and encrypted parameters in the eu-west-3 region (Paris, France). Amazon SES is implemented there but is not currently used for production delivery."],
        ["Postmark (ActiveCampaign)", "Initial transactional transport, domain authentication, delivery, bounce, and complaint events, and system emails (invitations, verifications). Processing in the United States; content retention is set to a maximum of 28 days. Transfers are governed by Postmark’s data processing agreement."],
        ["Stripe", "Subscription, billing, payment, and customer portal. Payment data is processed directly by Stripe; any transfer to the United States is governed by Stripe’s data processing agreement."],
        ["Google", "Optional OAuth sign-in provider for invited members: Google receives the sign-in request and returns the name, email address, and profile picture. Other authentication and organization data is stored by Yodev with Better Auth."],
      ],
    },
    sla: {
      title: "Beta SLA and incidents",
      intro: "Service levels applicable during the private beta.",
      sections: [
        ["Beta scope", "The beta is a guided service with no financially guaranteed availability commitment. Yodev targets 99.5% monthly availability, excluding announced maintenance and external dependencies."],
        ["Priorities", "A critical incident prevents all acceptance or creates a security risk; a major incident degrades an essential function; a minor incident has an acceptable workaround."],
        ["Communication", `Critical incidents are prioritized and communicated to affected customers through the available channel. Support requests are sent to ${support}.`],
        ["Security", "Suspected breaches, compromised keys, or abuse must be reported immediately. Yodev may suspend sending during the investigation and notify relevant parties as required."],
        ["Maintenance", "Planned maintenance is announced where possible. Domain changes are drained before switching and never trigger automatic failover for a message already submitted."],
      ],
    },
  };
}
