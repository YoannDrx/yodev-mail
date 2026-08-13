import { isIP } from "node:net";
import { resolve4, resolve6 } from "node:dns/promises";

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4) return false;
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) || parts[0] === 0;
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
