import { defineConfig, devices } from "@playwright/test";

const e2ePort = 3917;
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
    command: `env DATABASE_URL= DATABASE_URL_UNPOOLED= BETTER_AUTH_SECRET= BETTER_AUTH_GOOGLE_CLIENT_ID= BETTER_AUTH_GOOGLE_CLIENT_SECRET= npm run dev -- --port ${e2ePort}`,
    url: e2eBaseUrl,
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
