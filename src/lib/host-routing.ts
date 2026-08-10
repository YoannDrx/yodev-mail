const APP_HOST = "mail.yodev.fr";
const API_HOST = "api.mail.yodev.fr";
const LINKS_HOST = "links.mail.yodev.fr";

const apiPaths = ["/v1", "/openapi.json", "/health", "/api/health"];
const linkPaths = ["/u", "/health", "/api/health"];

function isWithin(pathname: string, roots: string[]) {
  return roots.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

export function canonicalUrlForHost(hostHeader: string | null, url: URL) {
  const hostname = (hostHeader ?? "").split(":")[0].toLowerCase();
  const canonical = new URL(url);

  if (hostname === API_HOST && !isWithin(url.pathname, apiPaths)) {
    canonical.hostname = APP_HOST;
    canonical.pathname = "/";
    canonical.search = "";
    return canonical;
  }

  if (hostname === LINKS_HOST && !isWithin(url.pathname, linkPaths)) {
    canonical.hostname = APP_HOST;
    canonical.pathname = "/";
    canonical.search = "";
    return canonical;
  }

  if (hostname === APP_HOST && isWithin(url.pathname, ["/v1", "/openapi.json", "/health"])) {
    canonical.hostname = API_HOST;
    return canonical;
  }

  if (hostname === APP_HOST && isWithin(url.pathname, ["/u"])) {
    canonical.hostname = LINKS_HOST;
    return canonical;
  }

  if (hostname === "vigie-mail.vercel.app" || hostname === "yodev-mail.vercel.app") {
    canonical.hostname = isWithin(url.pathname, ["/v1", "/openapi.json", "/health"])
      ? API_HOST
      : isWithin(url.pathname, ["/u"])
        ? LINKS_HOST
        : APP_HOST;
    return canonical;
  }

  return null;
}
