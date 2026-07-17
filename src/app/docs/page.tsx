import { PageShell } from "@/components/page-shell";
export default function DocsPage(){return <PageShell eyebrow="API transactionnelle" title="Un appel. Un email. Un statut traçable." intro="Une API HTTP prévisible, documentée en OpenAPI, avec idempotence et webhooks signés."><div className="grid gap-8 lg:grid-cols-[1fr_1.3fr]"><div><h2 className="text-2xl font-semibold">Envoyer un email</h2><p className="mt-3 leading-7 text-muted-foreground">Utilisez une clé <code>vm_test_</code> en sandbox, puis passez à <code>vm_live_</code> après validation du domaine et du workspace.</p><div className="mt-6 rounded-2xl border bg-white p-5 text-sm"><p><strong>POST</strong> /v1/emails</p><p className="mt-2 text-muted-foreground">Authorization: Bearer vm_live_…</p><p className="text-muted-foreground">Idempotency-Key: order-1234</p></div></div><pre className="overflow-x-auto rounded-3xl bg-[#17151f] p-6 text-sm leading-6 text-zinc-200"><code>{`curl https://api.vigie-mail.fr/v1/emails \\
  -H "Authorization: Bearer vm_live_..." \\
  -H "Idempotency-Key: order-1234" \\
  -H "Content-Type: application/json" \\
  -d '{
    "from": { "email": "notifications@client.fr" },
    "to": [{ "email": "alice@example.com" }],
    "subject": "Votre commande",
    "html": "<p>Votre commande est confirmée.</p>",
    "text": "Votre commande est confirmée."
  }'`}</code></pre></div></PageShell>}
