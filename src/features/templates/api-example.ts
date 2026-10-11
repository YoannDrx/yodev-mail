import { sampleVariables } from "@/features/templates/document";
import { siteConfig } from "@/lib/site-config";

export const testKeyPlaceholder = "ym_test_VOTRE_CLE";

/** Public API origin: production serves /v1 on its dedicated host, other environments on the app origin. */
export function apiBaseUrl(appUrl: string = siteConfig.appUrl) {
  const url = new URL(appUrl);
  return url.hostname === "mail.yodev.fr" ? siteConfig.apiUrl : url.origin;
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/**
 * A ready-to-run test-mode call for one template. Test keys run the full
 * validation and return 202 `simulated` without delivery or billing.
 */
export function templateCurlExample(input: {
  baseUrl: string;
  templateId: string;
  category: string;
  fromDomain: string;
  variables: string[];
  apiKey?: string;
}) {
  const body = {
    from: { email: `notifications@${input.fromDomain}` },
    to: { email: "destinataire@example.com" },
    category: input.category,
    content: { templateId: input.templateId, variables: sampleVariables(input.variables) },
  };
  return [
    `curl -sS -X POST ${shellQuote(`${input.baseUrl}/v1/emails`)} \\`,
    `  -H ${shellQuote(`Authorization: Bearer ${input.apiKey ?? testKeyPlaceholder}`)} \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -H "Idempotency-Key: $(date +%s)-$RANDOM" \\`,
    `  --data ${shellQuote(JSON.stringify(body))}`,
  ].join("\n");
}
