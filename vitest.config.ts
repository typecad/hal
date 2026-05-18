import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // packages/framework-arduino/tests/ uses the @typehal/expect hardware test framework
    // (TypeHAL fluent describe/it/expect API), not Vitest. They run on real Arduino
    // hardware via `npm run test:hw`. Excluding them prevents spurious Vitest load errors.
    exclude: ["node_modules", "dist"],
    setupFiles: ["tests/setup-framework.ts"],
    testTimeout: 60000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/cli.ts"],
    },
  },
});