// ---------------------------------------------------------------------------
// Tests for framework-avr native driver shim gating.
//
// framework-avr emits ~400 lines of native peripheral drivers (UART, SPI,
// TWI/I2C, EEPROM, tone, millis Timer0 ISR) even for a trivial program like
// `led.toggle()`. These tests pin the rule that each driver shim is emitted
// ONLY when the program actually uses that peripheral — mirroring how
// framework-arduino gates its shims via programAnalysis.usesX flags.
//
// Uses buildProgramIR with real TypeScript so the IR (and the hal-op lowering
// feeding analyzeProgram) matches what the transpiler actually produces.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { NativeAVRStrategy } from "../../../packages/framework-avr/src/strategy";
import { ATMEGA328P, setActiveChip } from "../../../packages/framework-avr/src/chips/index.js";
import { buildProgramIR } from "../../../packages/cuttlefish/src/testing";
import { analyzeProgram } from "../../../packages/cuttlefish/src/ir/program-analysis";
import type { ProgramIR, PlatformContext } from "@typecad/cuttlefish/api/shared";

function build(source: string): ProgramIR {
  return buildProgramIR("test.ts", source) as any as ProgramIR;
}

/** Build a PlatformContext with the analysis pre-populated for `program`. */
function ctxFor(program: ProgramIR, strategy: NativeAVRStrategy): PlatformContext {
  const analysis = analyzeProgram(program, strategy);
  return { frameworkData: { buildTarget: "arduino:avr:uno" }, analysis } as any as PlatformContext;
}

/** All native shim text (shimLines + polyfill helperFunctions) joined. */
function nativeShimText(strategy: NativeAVRStrategy, program: ProgramIR, ctx: PlatformContext): string {
  const shim = strategy.shimLines(program, ctx).join("\n");
  const poly = strategy.generateNativePolyfills(program, ctx)
    .flatMap(p => [...(p.helperFunctions ?? []), ...(p.helperStructs ?? [])])
    .join("\n");
  return shim + "\n" + poly;
}

const TRIVIAL = `import { D13 } from '@typecad/board-arduino-uno';
const led = D13.asOutput();
led.toggle();`;

describe("NativeAVRStrategy native driver shim gating", () => {
  let strategy: NativeAVRStrategy;
  beforeEach(() => {
    setActiveChip(ATMEGA328P);
    strategy = new NativeAVRStrategy();
  });

  // ── Negative direction: a program that uses NOTHING peripheral ──────────
  describe("trivial program (no peripheral usage)", () => {
    it("omits the UART driver shim", () => {
      const program = build(TRIVIAL);
      const ctx = ctxFor(program, strategy);
      const text = nativeShimText(strategy, program, ctx);
      expect(text).not.toContain("_uart_init");
      expect(text).not.toContain("_uart_print");
    });

    it("omits the SPI driver shim", () => {
      const program = build(TRIVIAL);
      const ctx = ctxFor(program, strategy);
      expect(nativeShimText(strategy, program, ctx)).not.toContain("_spi_init");
    });

    it("omits the TWI/I2C driver shim", () => {
      const program = build(TRIVIAL);
      const ctx = ctxFor(program, strategy);
      expect(nativeShimText(strategy, program, ctx)).not.toContain("_twi_init");
    });

    it("omits the EEPROM driver shim", () => {
      const program = build(TRIVIAL);
      const ctx = ctxFor(program, strategy);
      const text = nativeShimText(strategy, program, ctx);
      expect(text).not.toContain("_NativeEEPROM");
      expect(text).not.toContain("<avr/eeprom.h>");
    });

    it("omits the tone driver shim", () => {
      const program = build(TRIVIAL);
      const ctx = ctxFor(program, strategy);
      expect(nativeShimText(strategy, program, ctx)).not.toContain("_tc_tone_play");
    });

    it("omits the native millis Timer0 ISR polyfill", () => {
      const program = build(TRIVIAL);
      const ctx = ctxFor(program, strategy);
      const polyfills = strategy.generateNativePolyfills(program, ctx);
      expect(polyfills.map(p => p.id)).not.toContain("native_millis");
    });

    it("does not call _init_millis() in setupInitCode", () => {
      const program = build(TRIVIAL);
      const ctx = ctxFor(program, strategy);
      const init = strategy.setupInitCode!(program, ctx).join("\n");
      expect(init).not.toContain("_init_millis");
    });

    it("int main() omits the 2s UART startup delay", () => {
      const program = build(TRIVIAL);
      const ctx = ctxFor(program, strategy);
      // The DTR-reset startup delay only matters when UART is used.
      expect(nativeShimText(strategy, program, ctx)).not.toContain("_native_delay_ms(2000)");
    });

    it("omits the _native_delay_ms/_native_delay_us helpers (no timing/I2C consumer)", () => {
      // led.toggle() uses no delay/Timing/I2C, so neither the Timing struct
      // (which calls _native_delay_ms/us) nor _twi_recover (which calls
      // _native_delay_us) is emitted. The helpers are therefore dead code.
      const program = build(TRIVIAL);
      const ctx = ctxFor(program, strategy);
      const text = nativeShimText(strategy, program, ctx);
      expect(text).not.toContain("_native_delay_ms");
      expect(text).not.toContain("_native_delay_us");
    });

    it("omits the _native_map/_native_constrain helpers (no map()/constrain() call)", () => {
      const program = build(TRIVIAL);
      const ctx = ctxFor(program, strategy);
      const text = nativeShimText(strategy, program, ctx);
      expect(text).not.toContain("_native_map");
      expect(text).not.toContain("_native_constrain");
    });

    it("omits <util/delay.h> (no delay/I2C consumer) and <avr/interrupt.h> (no ISR)", () => {
      // led.toggle() uses no delay/timing/I2C/tone/interrupts, so neither
      // header's symbols are referenced. F_CPU still ships (chip descriptor
      // bake-in), but the two includes are dead weight.
      const program = build(TRIVIAL);
      const ctx = ctxFor(program, strategy);
      const text = nativeShimText(strategy, program, ctx);
      expect(text).not.toContain("<util/delay.h>");
      expect(text).not.toContain("<avr/interrupt.h>");
    });
  });

  // ── Positive direction: each peripheral's program retains its shim ──────
  describe("UART-using program", () => {
    const SRC = `console.log("hi");`;
    it("emits the UART driver shim", () => {
      const program = build(SRC);
      const ctx = ctxFor(program, strategy);
      expect(nativeShimText(strategy, program, ctx)).toContain("_uart_init");
    });
  });

  describe("SPI-using program", () => {
    const SRC = `import { SPI0 } from '@typecad/framework-arduino/arduino';
SPI0.begin();`;
    it("emits the SPI driver shim", () => {
      const program = build(SRC);
      const ctx = ctxFor(program, strategy);
      expect(nativeShimText(strategy, program, ctx)).toContain("_spi_init");
    });
  });

  describe("I2C-using program", () => {
    const SRC = `import { I2C0 } from '@typecad/framework-arduino/arduino';
I2C0.begin();`;
    it("emits the TWI/I2C driver shim", () => {
      const program = build(SRC);
      const ctx = ctxFor(program, strategy);
      expect(nativeShimText(strategy, program, ctx)).toContain("_twi_init");
    });
  });

  describe("EEPROM-using program", () => {
    const SRC = `EEPROM.write(0, 5);`;
    it("emits the EEPROM driver shim", () => {
      const program = build(SRC);
      const ctx = ctxFor(program, strategy);
      expect(nativeShimText(strategy, program, ctx)).toContain("_NativeEEPROM");
    });
  });

  describe("tone-using program", () => {
    const SRC = `tone(9, 440, 100);`;
    it("emits the tone driver shim", () => {
      const program = build(SRC);
      const ctx = ctxFor(program, strategy);
      expect(nativeShimText(strategy, program, ctx)).toContain("_tc_tone_play");
    });
  });

  describe("timing-using program", () => {
    const SRC = `delay(100);`;
    it("emits the native millis Timer0 ISR polyfill", () => {
      const program = build(SRC);
      const ctx = ctxFor(program, strategy);
      expect(strategy.generateNativePolyfills(program, ctx).map(p => p.id)).toContain("native_millis");
    });
    it("calls _init_millis() in setupInitCode", () => {
      const program = build(SRC);
      const ctx = ctxFor(program, strategy);
      expect(strategy.setupInitCode!(program, ctx)).toContain("_init_millis()");
    });
  });

  // ── delay/map/constrain helpers are gated on their actual consumers ─────
  describe("timing-using program (delay)", () => {
    const SRC = `delay(100);`;
    it("emits _native_delay_ms/_native_delay_us (Timing/delay needs them)", () => {
      const program = build(SRC);
      const ctx = ctxFor(program, strategy);
      const text = nativeShimText(strategy, program, ctx);
      expect(text).toContain("_native_delay_ms");
      expect(text).toContain("_native_delay_us");
    });
  });

  describe("I2C-using program (needs _native_delay_us for bus recovery)", () => {
    const SRC = `import { I2C0 } from '@typecad/framework-arduino/arduino';
I2C0.begin();`;
    it("emits _native_delay_us (consumed by _twi_recover)", () => {
      const program = build(SRC);
      const ctx = ctxFor(program, strategy);
      expect(nativeShimText(strategy, program, ctx)).toContain("_native_delay_us");
    });
  });

  describe("map/constrain-using program", () => {
    const SRC = `const x = map(5, 0, 10, 0, 255);
const y = constrain(x, 0, 100);`;
    it("emits _native_map/_native_constrain", () => {
      const program = build(SRC);
      const ctx = ctxFor(program, strategy);
      const text = nativeShimText(strategy, program, ctx);
      expect(text).toContain("_native_map");
      expect(text).toContain("_native_constrain");
    });
  });
});
