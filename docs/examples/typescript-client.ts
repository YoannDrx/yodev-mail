const apiUrl = process.env.YODEV_MAIL_API_URL ?? "https://api.mail.yodev.fr";
const apiKey = process.env.YODEV_MAIL_API_KEY;
if (!apiKey) throw new Error("YODEV_MAIL_API_KEY is required");

export async function sendOperationsAlert(input: {
  templateId: string;
  recipient: string;
  kind: "job_dead_letter" | "stripe_webhook_failed" | "mutation_ambiguous";
  sourceId: string;
  label: string;
  title: string;
  description: string;
  operationsUrl: string;
}) {
  const response = await fetch(`${apiUrl}/v1/emails`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": `operations-alert:${input.kind}:${input.sourceId}`,
    },
    body: JSON.stringify({
      from: { email: "ads@yodev.fr", name: "Ads by Yodev" },
      to: { email: input.recipient },
      category: "operations_alert",
      content: { templateId: input.templateId, variables: {
        label: input.label,
        title: input.title,
        description: input.description,
        sourceId: input.sourceId,
        operationsUrl: input.operationsUrl,
      } },
      metadata: { referenceId: input.sourceId },
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Mail by Yodev rejected the request: ${payload?.error?.code ?? response.status}`);
  return payload.data as { id: string; status: "queued" | "simulated" };
}
