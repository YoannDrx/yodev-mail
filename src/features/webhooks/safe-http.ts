import { lookup as dnsLookup } from "node:dns/promises";
import { Agent, request } from "node:https";
import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import { isPrivateAddress } from "@/features/webhooks/validate-url";

export function selectPublicLookupAddress(
  addresses: LookupAddress[],
  isAllowedAddress: (address: string) => boolean = (address) => !isPrivateAddress(address),
) {
  if (!addresses.length || addresses.some((entry) => !isAllowedAddress(entry.address))) {
    throw new Error("Webhook DNS resolution was rejected.");
  }
  return addresses[0];
}

// Socket-time resolution. Every address of the answer is checked before the
// socket connects and the connection uses only those checked addresses, so a
// second DNS answer can never rebind the request to a private network.
// Node 20+ calls lookup with `{ all: true }` (happy eyeballs) and then expects
// an array; answering a single address there fails every delivery.
export function createPinnedLookup(isAllowedAddress?: (address: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    void dnsLookup(hostname, { all: true, verbatim: true })
      .then((addresses) => {
        selectPublicLookupAddress(addresses, isAllowedAddress);
        const family = options.family === 4 || options.family === 6 ? options.family : undefined;
        const usable = family ? addresses.filter((entry) => entry.family === family) : addresses;
        if (!usable.length) throw new Error("Webhook DNS resolution was rejected.");
        if (options.all) callback(null, usable);
        else callback(null, usable[0].address, usable[0].family);
      })
      .catch((error: unknown) => {
        if (options.all) callback(error as Error, []);
        else callback(error as Error, "", 4);
      });
  };
}

// Production never passes this argument. It exists so a test can reach a
// local TLS server: loopback is refused by the default address policy.
export type WebhookTransportOverrides = {
  isAllowedAddress: (address: string) => boolean;
  ca: string;
};

export async function postWebhookSafely(input: {
  url: string;
  body: string;
  headers: Record<string, string>;
  timeoutMs: number;
}, overrides?: WebhookTransportOverrides) {
  const url = new URL(input.url);
  const agent = new Agent({
    keepAlive: false,
    lookup: createPinnedLookup(overrides?.isAllowedAddress),
    ...(overrides ? { ca: overrides.ca } : {}),
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
