import { defineConfig } from "vitest/config";

// The simulator suite (sim/). The hardware tests in tests/ are NOT vitest
// tests — they are transpiled, flashed, and run on the board via
// `npm run test:hw` (typecad-hal test).
//
// This config lives in the project so `npm run simulate` cannot inherit the
// monorepo root's vitest include pattern (tests/**) and silently match nothing.
// The package.json declares "type": "module", so this file loads as ESM under
// Vite's native config loader.
export default defineConfig({
  test: {
    environment: "node",
    include: ["sim/**/*.test.ts"],
  },
});
