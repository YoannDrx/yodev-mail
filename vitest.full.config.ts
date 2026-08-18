import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json", "clover"],
      thresholds: {
        branches: 60,
        functions: 60,
        lines: 70,
        statements: 70,
        "src/features/onboarding/reconcile-owner.ts": {
          branches: 90,
          lines: 90,
        },
        "src/features/providers/ingest-event.ts": {
          branches: 90,
          lines: 90,
        },
        "src/workers/send-email.ts": {
          branches: 90,
          lines: 90,
        },
        "src/workers/attachment-scan.ts": {
          branches: 75,
          lines: 95,
        },
        "src/workers/deliver-webhook.ts": {
          branches: 85,
          lines: 70,
        },
        "src/workers/report-stripe-usage.ts": {
          branches: 65,
          lines: 95,
        },
      },
    },
    environment: "node",
    exclude: ["e2e/**", "node_modules/**", ".next/**", "cdk.out/**"],
    fileParallelism: false,
    setupFiles: ["./test/integration/setup.ts"],
    testTimeout: 20_000,
  },
});
