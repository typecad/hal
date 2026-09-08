import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
      include: ["tests/**/*.test.ts"],
      // The hardware test suites (packages/hal/tests/** — fluent
      // describe/it/expect transpiled to firmware) are not Vitest tests; they
      // run on real hardware via `npm run test:hw`. This include pattern only
      // matches the root tests/ tree, so they are never loaded here.
      exclude: ["node_modules", "dist"],
    setupFiles: ["tests/setup-framework.ts"],
    testTimeout: 60000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: [
        "packages/*/src/**/*.ts",
        "mcus/*/src/**/*.ts",
        "boards/*/src/**/*.ts",
      ],
    },
  },
});