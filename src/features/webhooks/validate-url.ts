import { BlockList, isIP } from "node:net";
import { resolve4, resolve6 } from "node:dns/promises";

const reservedIpv4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) reservedIpv4.addSubnet(network, prefix, "ipv4");

const reservedIpv6 = new BlockList();
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) reservedIpv6.addSubnet(network, prefix, "ipv6");

export function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
  const family = isIP(normalized);
  if (family === 4) return reservedIpv4.check(normalized, "ipv4");
  if (family === 6) return reservedIpv6.check(normalized, "ipv6");
  return true;
}

export async function validateWebhookUrl(value: string) {
  const url = new URL(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:") throw new Error("Le webhook doit utiliser HTTPS");
  if (url.username || url.password || url.port) throw new Error("Identifiants et ports personnalisés sont interdits");
  if (hostname === "localhost" || (isIP(hostname) && isPrivateAddress(hostname))) throw new Error("Adresse privée interdite");
  if (isIP(hostname)) return url.toString();
  const addresses = [...await resolve4(hostname).catch(() => []), ...await resolve6(hostname).catch(() => [])];
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error("Le domaine du webhook ne doit résoudre que vers des adresses publiques");
  return url.toString();
}
