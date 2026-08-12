import { PageShell } from "@/components/page-shell";

const example = [
  "curl https://api.mail.yodev.fr/v1/emails \\",
  '  -H "Authorization: Bearer ym_live_..." \\',
  '  -H "Idempotency-Key: order-1234" \\',
  '  -H "Content-Type: application/json" \\',
  "  -d '{",
  '    "from": { "email": "notifications@client.fr" },',
  '    "to": { "email": "alice@example.com" },',
  '    "category": "payment_receipt",',
  '    "content": {',
  '      "templateId": "00000000-0000-0000-0000-000000000000",',
  '      "variables": { "invoiceNumber": "INV-123" }',
  "    },",
  '    "metadata": { "referenceId": "order_123" }',
  "  }'",
].join("\n");

export default function DocsPage(){return <PageShell eyebrow="API transactionnelle" title="Un appel. Un événement applicatif. Un destinataire." intro="Clé d’idempotence obligatoire, cas d’usage approuvé et template approuvé par défaut."><div className="grid gap-8 lg:grid-cols-[1fr_1.3fr]"><div><h2 className="text-2xl font-semibold">Envoyer avec un template</h2><p className="mt-3 leading-7 text-muted-foreground">Une clé <code>ym_test_</code> valide toute la requête sans livrer. Une clé <code>ym_live_</code> n’est créée qu’après revue du workspace et du domaine.</p><div className="mt-6 rounded-2xl border bg-white p-5 text-sm"><p><strong>POST</strong> /v1/emails</p><p className="mt-2 text-muted-foreground">Authorization: Bearer ym_live_…</p><p className="text-muted-foreground">Idempotency-Key: order-1234</p></div><p className="mt-5 text-sm"><a className="text-primary underline" href="/openapi.json">Télécharger la spécification OpenAPI</a></p></div><pre className="overflow-x-auto rounded-3xl bg-[#0C1117] p-6 text-sm leading-6 text-zinc-200"><code>{example}</code></pre></div></PageShell>}
