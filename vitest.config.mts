import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: false,
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      reporter: ["text", "html"],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 85,
      },
    },
  },
  resolve: {
    alias: {
      "@": new URL("./src/", import.meta.url).pathname,
    },
  },
});
