import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const publicPaths = [
  "",
  "/fonctionnalites",
  "/tarifs",
  "/delivrabilite",
  "/conformite",
  "/docs",
  "/contact",
  "/inscription",
  "/anti-abus",
  "/confidentialite",
  "/cgu",
  "/mentions-legales",
  "/dpa",
  "/sous-traitants",
  "/sla",
];
// /inscription belongs to the authentication workstream, which sets its own title.
const marketingPaths = publicPaths.filter((path) => path !== "/inscription");
const authenticationPaths = [
  "/connexion",
  "/mot-de-passe-oublie",
  "/reinitialiser-mot-de-passe?token=test-reset-token",
  "/invitation?id=00000000-0000-0000-0000-000000000000",
];

/** Records CSP violations reported by the browser, from both the DOM event and the console. */
async function watchCsp(page: Page) {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to (execute|load|apply)/i.test(message.text())) violations.push(message.text());
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`Content Security Policy violation: ${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return violations;
}

async function expectNoAxeViolations(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(result.violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => node.target) })), label).toEqual([]);
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`every public page passes axe WCAG A/AA in the ${colorScheme} theme without CSP violations`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.emulateMedia({ colorScheme });
    const violations = await watchCsp(page);
    for (const locale of colorScheme === "light" ? ["fr", "en"] : ["fr"]) {
      for (const path of [...publicPaths, ...authenticationPaths]) {
        const url = `/${locale}${path}`;
        await page.goto(url);
        await expect(page.locator("html"), url).toHaveClass(new RegExp(`\\b${colorScheme}\\b`));
        await expectNoAxeViolations(page, url);
      }
    }
    expect(violations).toEqual([]);
  });
}

test("public pages have distinct localized titles, descriptions and hreflang alternates", async ({ page }) => {
  test.setTimeout(180_000);
  for (const locale of ["fr", "en"] as const) {
    const titles = new Set<string>();
    for (const path of marketingPaths) {
      const response = await page.goto(`/${locale}${path}`);
      expect(response?.headers()["x-robots-tag"]).toBeUndefined();
      const title = await page.title();
      expect(title, path).toContain("Mail by Yodev");
      expect(titles.has(title), `${locale}${path} duplicates "${title}"`).toBe(false);
      titles.add(title);
      const description = await page.locator('meta[name="description"]').getAttribute("content");
      expect(description?.length, path).toBeGreaterThan(40);
      await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
      await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute("href", new RegExp(`//[^/]+${path}/?$`));
      await expect(page.locator('link[rel="alternate"][hreflang="fr"]')).toHaveAttribute("href", new RegExp(`/fr${path}$`));
      await expect(page.locator('meta[property="og:image"]').first()).toHaveAttribute("content", new RegExp(`/opengraph-image\\?locale=${locale}$`));
    }
  }
});

test("authentication pages are not indexable and robots.txt covers locale-prefixed private routes", async ({ page, request }) => {
  for (const path of authenticationPaths) {
    await page.goto(`/fr${path}`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  }
  const robots = await (await request.get("/robots.txt")).text();
  for (const route of ["/fr/dashboard", "/en/dashboard", "/fr/admin", "/en/admin", "/fr/onboarding", "/en/invitation", "/fr/connexion", "/en/reinitialiser-mot-de-passe"]) {
    expect(robots).toContain(`Disallow: ${route}`);
  }
  expect(robots).not.toContain("Disallow: /fr/tarifs");
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain('hreflang="x-default"');
});

test("the skip link reaches the main content", async ({ page }) => {
  for (const path of ["/fr/tarifs", "/en", "/fr/connexion"]) {
    await page.goto(path);
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: /Aller au contenu principal|Skip to main content/ });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  }
});

test("form control borders reach 3:1 against their surface in both themes (WCAG 1.4.11)", async ({ page }) => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto("/fr/mot-de-passe-oublie");
    const ratios = await page.evaluate(() => {
      // Computed colors come back as rgb()/rgba() or, for color-mix(), as color(srgb r g b) in 0..1.
      const rgb = (value: string) => {
        const numbers = (value.replace(/^color\(srgb/, "").match(/[\d.]+/g) ?? []).map(Number);
        return value.startsWith("color(srgb") ? [...numbers.slice(0, 3).map((n) => n * 255), numbers[3] ?? 1] : numbers;
      };
      const luminance = ([r, g, b]: number[]) => {
        const channel = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      };
      const surface = (element: Element) => {
        for (let node: Element | null = element.parentElement; node; node = node.parentElement) {
          const [r, g, b, a = 1] = rgb(getComputedStyle(node).backgroundColor);
          if (a > 0) return [r, g, b];
        }
        return rgb(getComputedStyle(document.body).backgroundColor);
      };
      return [...document.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea")].map((control) => {
        const border = luminance(rgb(getComputedStyle(control).borderTopColor));
        const background = luminance(surface(control));
        return (Math.max(border, background) + 0.05) / (Math.min(border, background) + 0.05);
      });
    });
    expect(ratios.length, colorScheme).toBeGreaterThan(0);
    for (const ratio of ratios) expect(ratio, colorScheme).toBeGreaterThanOrEqual(3);
  }
});

test("the theme follows the operating-system preference by default", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/fr/docs");
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/fr/docs");
  await expect(page.locator("html")).toHaveClass(/\blight\b/);
});

test("marketing never promises gated features and states one VAT regime", async ({ page }) => {
  // The public e2e server starts with every gate closed (src/lib/env.ts defaults).
  await page.goto("/fr/tarifs");
  await expect(page.getByText(/Pièces jointes incluses/)).toHaveCount(0);
  const upcoming = page.locator("h3", { hasText: "Bientôt" }).locator("..");
  await expect(upcoming).toContainText("Pièces jointes");
  await expect(upcoming).toContainText("Webhooks clients signés");
  await expect(upcoming).toContainText("Envois live");
  await expect(page.getByText("TVA non applicable, article 293 B du Code général des impôts.")).toBeVisible();
  await expect(page.getByText(/TVA appliquée/)).toHaveCount(0);
  await expect(page.getByText(/^29\s€/).first()).toBeVisible();
  await expect(page.getByText("Aucun pixel de suivi", { exact: true })).toBeVisible();

  await page.goto("/fr/cgu");
  await expect(page.getByText(/TVA non applicable, article 293 B du Code général des impôts\./)).toBeVisible();
  await expect(page.getByText(/indemnité forfaitaire pour frais de recouvrement de 40 €/)).toBeVisible();
  await page.goto("/fr/mentions-legales");
  await expect(page.getByText("TVA non applicable, article 293 B du Code général des impôts.", { exact: true })).toBeVisible();

  await page.goto("/fr/fonctionnalites");
  await expect(page.getByText("Bientôt", { exact: true })).toHaveCount(2);
  await page.goto("/fr/delivrabilite");
  await expect(page.getByText("AUCUN PIXEL DE SUIVI", { exact: true })).toBeVisible();

  await page.goto("/fr/docs");
  const code = (await page.locator("pre code").allTextContents()).join("\n");
  expect(code).toContain("Bearer ym_test_");
  expect(code).not.toContain("ym_live_");
  expect(code).toContain('"status": "simulated"');
  await expect(page.getByText(/503 live_email_acceptance_disabled/)).toBeVisible();
});

test("the footer leads to contact and support", async ({ page }) => {
  await page.goto("/fr");
  await page.getByRole("contentinfo").getByRole("link", { name: "Contact et support" }).click();
  await expect(page).toHaveURL(/\/fr\/contact$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator('main a[href="mailto:support@yodev.fr"]')).toBeVisible();
  await expect(page.locator('main a[href="mailto:hello@yodev.fr"]')).toBeVisible();
});

test("social image and icon routes load without CSP violations", async ({ page }) => {
  const violations = await watchCsp(page);
  for (const path of ["/opengraph-image?locale=fr", "/opengraph-image?locale=en", "/icon", "/apple-icon"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    expect(response?.headers()["content-type"]).toContain("image/png");
    expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  }
  expect(violations).toEqual([]);
});

test("an injected inline script without the nonce is blocked and reported", async ({ page }) => {
  const violations = await watchCsp(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/fr/tarifs", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace("</body>", "<script>window.__injected = true</script></body>");
    await route.fulfill({ response, body });
  });
  await page.goto("/fr/tarifs");
  await expect.poll(() => violations.length).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as unknown as { __injected?: boolean }).__injected)).toBeUndefined();
  // Next.js and next-themes scripts carry the nonce, so the page still hydrates.
  // A click that lands before hydration is a no-op, so retry it until React
  // owns the button; page errors explain a real hydration failure.
  await page.waitForLoadState("networkidle");
  const before = await page.locator("html").getAttribute("class");
  const toggle = page.getByRole("button", { name: "Changer le thème", exact: true });
  await expect(async () => {
    await toggle.click();
    await expect(page.locator("html"), pageErrors.join("\n")).not.toHaveAttribute("class", before ?? "", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
});

test("pages are served with a nonce-based script policy", async ({ page }) => {
  const response = await page.goto("/fr");
  const policy = response?.headers()["content-security-policy"] ?? "";
  const scriptSrc = policy.split(";").find((directive) => directive.trim().startsWith("script-src")) ?? "";
  expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
  expect(scriptSrc).not.toContain("'unsafe-inline'");
  expect(response?.headers()["x-frame-options"]).toBe("DENY");
  expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
  const nonce = /'nonce-([^']+)'/.exec(scriptSrc)?.[1];
  // The browser hides nonce attributes from the DOM, so count scripts that executed instead.
  expect(nonce).toBeTruthy();
  const second = await page.request.get("/fr");
  expect(second.headers()["content-security-policy"]).not.toContain(`'nonce-${nonce}'`);
  const html = await second.text();
  const secondNonce = /'nonce-([^']+)'/.exec(second.headers()["content-security-policy"] ?? "")?.[1];
  expect(html).toContain(`nonce="${secondNonce}"`);
});
