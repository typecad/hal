import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // packages/framework-arduino/tests/ uses the @typecode/expect hardware test framework
    // (TypeCode fluent describe/it/expect API), not Vitest. They run on real Arduino
    // hardware via `npm run test:hw`. Excluding them prevents spurious Vitest load errors.
    exclude: ["node_modules", "dist"],
    setupFiles: ["tests/setup-framework.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/cli.ts"],
    },
  },
});