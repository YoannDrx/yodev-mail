import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["src/**/*.integration.test.ts"],
    setupFiles: ["./test/integration/setup.ts"],
    testTimeout: 20_000,
  },
});
