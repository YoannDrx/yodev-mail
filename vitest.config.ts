import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    // CDK suites bundle real Lambda workers; parallel cold syntheses can starve
    // each other and hit the default test deadline on developer machines.
    fileParallelism: false,
    exclude: ["e2e/**", "**/*.integration.test.ts", "node_modules/**", ".next/**", "cdk.out/**"],
    coverage: { provider: "v8", reporter: ["text", "html"] },
  },
});
