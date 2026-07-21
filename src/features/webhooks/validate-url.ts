import { isIP } from "node:net";
import { resolve4, resolve6 } from "node:dns/promises";

function isPrivateAddress(address: string) {
  if (address === "::1" || address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:")) return true;
  const parts = address.split(".").map(Number);
  if (parts.length !== 4) return false;
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) || parts[0] === 0;
}

export async function validateWebhookUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Le webhook doit utiliser HTTPS");
  if (url.username || url.password || url.port) throw new Error("Identifiants et ports personnalisés sont interdits");
  if (url.hostname === "localhost" || (isIP(url.hostname) && isPrivateAddress(url.hostname))) throw new Error("Adresse privée interdite");
  const addresses = [...await resolve4(url.hostname).catch(() => []), ...await resolve6(url.hostname).catch(() => [])];
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error("Le domaine du webhook ne doit résoudre que vers des adresses publiques");
  return url.toString();
}
