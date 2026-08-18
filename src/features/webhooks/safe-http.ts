import { lookup as dnsLookup } from "node:dns/promises";
import { Agent, request } from "node:https";
import type { LookupAddress } from "node:dns";
import { isPrivateAddress } from "@/features/webhooks/validate-url";

export function selectPublicLookupAddress(addresses: LookupAddress[]) {
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("Webhook DNS resolution was rejected.");
  }
  return addresses[0];
}

export async function postWebhookSafely(input: {
  url: string;
  body: string;
  headers: Record<string, string>;
  timeoutMs: number;
}) {
  const url = new URL(input.url);
  const agent = new Agent({
    keepAlive: false,
    lookup: (hostname, _options, callback) => {
      void dnsLookup(hostname, { all: true, verbatim: true })
        .then((addresses) => {
          const selected = selectPublicLookupAddress(addresses);
          callback(null, selected.address, selected.family);
        })
        .catch((error: unknown) => callback(error as Error, "", 4));
    },
  });

  try {
    return await new Promise<number>((resolve, reject) => {
      const outgoing = request(
        url,
        {
          agent,
          headers: input.headers,
          method: "POST",
          signal: AbortSignal.timeout(input.timeoutMs),
        },
        (response) => {
          response.resume();
          response.once("end", () => resolve(response.statusCode ?? 0));
        },
      );
      outgoing.once("error", reject);
      outgoing.end(input.body);
    });
  } finally {
    agent.destroy();
  }
}
