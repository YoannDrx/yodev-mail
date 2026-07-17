import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    exclude: ["e2e/**", "node_modules/**", ".next/**", "cdk.out/**"],
    coverage: { provider: "v8", reporter: ["text", "html"] },
  },
});
