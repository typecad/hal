import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // packages/framework-arduino/tests/ and packages/framework-esp32/tests/ use the
    // @typecad/expect hardware test framework (TypeCAD fluent describe/it/expect API),
    // not Vitest. They run on real hardware via `npm run test:hw`. tests/hardware/ holds
    // the same kind of hardware tests (HTTP-client end-to-end on ESP32). Excluding these
    // paths prevents spurious Vitest load errors on files that use a different harness.
    exclude: ["node_modules", "dist", "tests/hardware"],
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