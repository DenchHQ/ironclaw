import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["**/*.live.test.ts", "**/*.e2e.test.ts"],
    testTimeout: 30_000,
  },
});
