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
      },
    },
    environment: "node",
    exclude: ["e2e/**", "node_modules/**", ".next/**", "cdk.out/**"],
    fileParallelism: false,
    setupFiles: ["./test/integration/setup.ts"],
    testTimeout: 20_000,
  },
});
