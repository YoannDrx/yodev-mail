import { defineConfig, devices } from "@playwright/test";

const e2ePort = 3017;
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: e2eBaseUrl,
    trace: "on-first-retry",
  },
  webServer: {
    command: `env DATABASE_URL= DATABASE_URL_UNPOOLED= NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY= CLERK_SECRET_KEY= npm run dev -- --port ${e2ePort}`,
    url: e2eBaseUrl,
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
