// ---------------------------------------------------------------------------
// Tests for AVR framework-arduino `<avr/wdt.h>` include emission.
//
// Pins the rule that the watchdog header is emitted ONLY when the program
// actually uses the watchdog. It used to be a forced include for every AVR
// program (even ones that never touch the watchdog, like `led.toggle()` in
// demos/demo). The fix gates the include on detection of `wdt.*` hal-ops in
// the cuttlefish setup emitter, since the HAL resolver lowers WDT.enable/
// reset/disable to bare wdt_*() calls that require the header.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { resolveArduinoProfile } from "../../../packages/framework-arduino/src/profile";
import { transpileArduino, hasInclude } from "../../setup";
import type { ProgramIR, PlatformContext } from "@typecad/cuttlefish/api/shared";

const UNO_CTX = { frameworkData: { buildTarget: "arduino:avr:uno" } } as PlatformContext;
const EMPTY_PROGRAM = { topLevelStatements: [], functions: [] } as any as ProgramIR;

describe("AVR framework-arduino profile resolution", () => {
  it("forces <Arduino.h> for the Uno FQBN", () => {
    const result = resolveArduinoProfile(EMPTY_PROGRAM, UNO_CTX);
    expect(result.forcedIncludes).toContain("<Arduino.h>");
  });

  it("does not force <avr/wdt.h> (gated on watchdog usage in the setup emitter)", () => {
    // Regression guard: the AVR profile must not carry `<avr/wdt.h>` as a
    // forced include. The header is added on demand by the cuttlefish setup
    // emitter only when the program contains `wdt.*` hal-ops — forcing it
    // here leaked it into every AVR program (e.g. demos/demo's `led.toggle()`).
    const result = resolveArduinoProfile(EMPTY_PROGRAM, UNO_CTX);
    expect(result.forcedIncludes).not.toContain("<avr/wdt.h>");
  });
});

describe("AVR <avr/wdt.h> include emission (end-to-end)", () => {
  it("omits <avr/wdt.h> from output when the program never uses the watchdog", () => {
    // Mirrors demos/demo/src/main.ts (the reported bug): a trivial AVR program
    // that only toggles a pin must not pull in the watchdog header.
    const result = transpileArduino(
      `import { D13 } from '@typecad/board-arduino-uno';
       const led = D13.asOutput();
       led.toggle();`,
      { platformContext: UNO_CTX },
    );
    expect(hasInclude(result.cpp, "<avr/wdt.h>")).toBe(false);
    expect(result.cpp).not.toContain("struct __tc_WDT");
  });

  it("still emits <avr/wdt.h> when the program uses WDT", () => {
    // Positive-direction guard: removing <avr/wdt.h> from forcedIncludes must
    // not break WDT-using programs. The setup emitter detects the `wdt.*`
    // hal-ops (WDT.enable/reset/disable lower to these) and adds the include.
    const result = transpileArduino(
      `import { WDT } from '@typecad/framework-arduino/arduino';
       WDT.enable('250ms');
       WDT.reset();
       WDT.disable();`,
      { platformContext: UNO_CTX },
    );
    expect(hasInclude(result.cpp, "<avr/wdt.h>")).toBe(true);
    expect(result.cpp).toContain("wdt_enable(WDTO_250MS)");
    expect(result.cpp).toContain("wdt_reset()");
    expect(result.cpp).toContain("wdt_disable()");
  });
});
