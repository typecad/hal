// ---------------------------------------------------------------------------
// Arduino `loop()` linkage regression.
//
// Symptom: `cuttlefish build --compile` against the ESP32 Arduino core fails:
//
//   error: 'void loop()' was declared 'extern' and later 'static' [-fpermissive]
//   note: previous declaration of 'void loop()'
//
// Root cause: the synthesizer creates `setup` and `loop` as the platform's
// two entrypoints, but the function emitter's `isEntrypoint` check only
// matched `setup` (the strategy's `entrypointFunctionName()`). `loop` fell
// through to the generic free-function path and picked up the `static`
// linkage qualifier (`needsStatic = !isExported && !isEntrypoint && ...`).
// The Arduino core (both AVR and ESP32) forward-declares `void loop(void)`
// as extern in Arduino.h, so a `static void loop()` definition redeclares it
// with conflicting linkage. AVR's toolchain tolerates it; the ESP32 core
// (newer GCC / stricter flags) errors out.
//
// Fix: treat `loop` as an entrypoint whenever the strategy requires a loop
// function, so it emits without `static` — symmetric with `setup`.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";

function transpileArduino(tsCode: string) {
  return transpile(tsCode, { target: "arduino" });
}

describe("Arduino loop() linkage", () => {
  it("emits `void loop()` (non-static) — no clash with the core's extern prototype", () => {
    const result = transpileArduino(`console.log('hello');`);
    const cpp = result.cpp ?? "";

    // The synthesized loop() must be non-static.
    expect(cpp).not.toMatch(/\bstatic\s+void\s+loop\s*\(/);
    // And the expected non-static definition must be present.
    expect(cpp).toMatch(/\bvoid\s+loop\s*\(\s*\)\s*\{/);
  });

  it("emits `void setup()` non-static too (symmetry / pre-existing behavior pinned)", () => {
    const result = transpileArduino(`console.log('hello');`);
    const cpp = result.cpp ?? "";
    expect(cpp).not.toMatch(/\bstatic\s+void\s+setup\s*\(/);
    expect(cpp).toMatch(/\bvoid\s+setup\s*\(\s*\)\s*\{/);
  });

  it("keeps an ordinary user free function `static` (the fix is scoped to entrypoints only)", () => {
    const result = transpileArduino(`
      function helper(x: number): number { return x + 1; }
      console.log(helper(2));
    `);
    const cpp = result.cpp ?? "";
    expect(cpp).toMatch(/\bstatic\s+\S+\s+helper\s*\(/);
  });
});
