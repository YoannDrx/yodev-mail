import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { localized } from "@/i18n/config";
import { getLocale } from "@/i18n/server";
import { getFeatureAvailability } from "@/lib/feature-availability";
import { publicPageMetadata } from "@/lib/public-metadata";
import { siteConfig } from "@/lib/site-config";

// Public examples always use a test key: it validates the full request and
// returns `simulated` without delivery or billing (see src/app/v1/emails).
const example = [
  `curl ${siteConfig.apiUrl}/v1/emails \\`,
  '  -H "Authorization: Bearer ym_test_..." \\',
  '  -H "Idempotency-Key: order-1234" \\',
  '  -H "Content-Type: application/json" \\',
  "  -d '{", '    "from": { "email": "notifications@client.fr" },', '    "to": { "email": "alice@example.com" },', '    "category": "payment_receipt",', '    "content": {', '      "templateId": "00000000-0000-0000-0000-000000000000",', '      "variables": { "invoiceNumber": "INV-123" }', "    },", '    "metadata": { "referenceId": "order_123" }', "  }'",
].join("\n");

const exampleResponse = [
  "HTTP/1.1 202 Accepted",
  "",
  '{ "data": { "id": "6f1c…", "status": "simulated" } }',
].join("\n");

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return publicPageMetadata(locale, "/docs", {
    title: localized(locale, { fr: "Documentation de l’API", en: "API documentation" }),
    description: localized(locale, {
      fr: "Envoyer un email transactionnel avec POST /v1/emails : clé ym_test_, en-tête Idempotency-Key, template approuvé et spécification OpenAPI.",
      en: "Send a transactional email with POST /v1/emails: a ym_test_ key, an Idempotency-Key header, an approved template, and the OpenAPI specification.",
    }),
  });
}

export default async function DocsPage() {
  const locale = await getLocale();
  const { liveSending, attachments } = getFeatureAvailability();
  const copy = localized(locale, {
    fr: { eyebrow: "API transactionnelle", title: "Un appel. Un événement applicatif. Un destinataire.", intro: "Clé d’idempotence obligatoire, cas d’usage approuvé et template approuvé par défaut.", heading: "Envoyer avec un template", text: "Une clé ym_test_ valide toute la requête sans livrer ni facturer et répond 202 avec le statut simulated. Une clé ym_live_ n’est créée qu’après revue du workspace et du domaine.", liveClosed: "Les envois live ne sont pas encore ouverts : une clé ym_live_ reçoit aujourd’hui 503 live_email_acceptance_disabled.", attachmentsClosed: "Les pièces jointes ne sont pas encore ouvertes : une requête qui en contient reçoit 503 attachments_unavailable.", request: "Requête", response: "Réponse", download: "Télécharger la spécification OpenAPI" },
    en: { eyebrow: "Transactional API", title: "One call. One application event. One recipient.", intro: "An idempotency key is required, with an approved use case and an approved template by default.", heading: "Send with a template", text: "A ym_test_ key validates the entire request without delivering or billing it and returns 202 with the simulated status. A ym_live_ key is created only after the workspace and domain have been reviewed.", liveClosed: "Live sending is not open yet: a ym_live_ key currently receives 503 live_email_acceptance_disabled.", attachmentsClosed: "Attachments are not open yet: a request that includes one receives 503 attachments_unavailable.", request: "Request", response: "Response", download: "Download the OpenAPI specification" },
  });
  return <PageShell eyebrow={copy.eyebrow} title={copy.title} intro={copy.intro}><div className="grid gap-8 lg:grid-cols-[1fr_1.3fr]"><div><h2 className="text-2xl font-semibold">{copy.heading}</h2><p className="mt-3 leading-7 text-muted-foreground">{copy.text}</p>{(!liveSending || !attachments) && <ul className="mt-4 grid gap-2 text-sm leading-6 text-muted-foreground">{!liveSending && <li>{copy.liveClosed}</li>}{!attachments && <li>{copy.attachmentsClosed}</li>}</ul>}<div className="mt-6 rounded-md border bg-card p-5 text-sm"><p><strong>POST</strong> /v1/emails</p><p className="mt-2 text-muted-foreground">Authorization: Bearer ym_test_…</p><p className="text-muted-foreground">Idempotency-Key: order-1234</p></div><p className="mt-5 text-sm"><a className="text-primary underline" href="/openapi.json">{copy.download}</a></p></div><div className="grid content-start gap-4"><figure><figcaption className="mb-2 text-sm font-medium text-muted-foreground">{copy.request}</figcaption><pre tabIndex={0} className="overflow-x-auto rounded-md border bg-card p-6 font-mono text-sm leading-6 text-foreground"><code>{example}</code></pre></figure><figure><figcaption className="mb-2 text-sm font-medium text-muted-foreground">{copy.response}</figcaption><pre tabIndex={0} className="overflow-x-auto rounded-md border bg-card p-6 font-mono text-sm leading-6 text-foreground"><code>{exampleResponse}</code></pre></figure></div></div></PageShell>;
}
