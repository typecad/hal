import { describe, it, expect } from "vitest";
import { NativeAVRStrategy } from "../../../packages/framework-avr/src/strategy";
import { ATMEGA328P, ATMEGA2560, setActiveChip } from "../../../packages/framework-avr/src/chips/index.js";
import { buildProgramIR } from "../../../packages/cuttlefish/src/testing";
import { analyzeProgram } from "../../../packages/cuttlefish/src/ir/program-analysis";
import type { ProgramIR, PlatformContext } from "@typecad/cuttlefish/api/shared";

// Native millis()/micros() via Timer0 overflow ISR.
//
// Before this work, framework-avr depended on millis()/micros() from the
// Arduino core (wiring.c) — a contradiction for a "no Arduino core" framework.
// The strategy emits its own Timer0 ISR + atomic millis()/micros() in a
// native_millis polyfill (not shimLines, because the emit pipeline filters
// shim lines containing 'millis()'). Driven by the chip descriptor's
// millisTimer config. These tests pin the generated C++ at the string level.
//
// The polyfill is gated on actual timing usage (usesNativeTiming) so a trivial
// program like `led.toggle()` doesn't pull in the Timer0 ISR. When ctx is
// undefined (no analysis available, e.g. direct strategy unit tests) the
// polyfill is emitted defensively — preserving the historical behavior.

const PROGRAM = {
  topLevelStatements: [],
  functions: [],
  classes: [],
  peripheralUsage: { pwmPinsUsed: new Set<number>(), outputPins: new Set<number>(), inputPins: new Set<number>(), inputPullupPins: new Set<number>() },
} as any as ProgramIR;

/** Extract the native_millis polyfill's helperFunctions as a joined string. */
function millisCode(program: ProgramIR): string {
  const polyfills = new NativeAVRStrategy().generateNativePolyfills(program, undefined as any);
  const millis = polyfills.find(p => p.id === "native_millis");
  return (millis?.helperFunctions ?? []).join("\n");
}

describe("NativeAVRStrategy millis()/micros() Timer0 ISR", () => {
  describe("ATmega328P", () => {
    it("emits the Timer0 overflow ISR with the megaAVR overflow vector", () => {
      setActiveChip(ATMEGA328P);
      const code = millisCode(PROGRAM);
      // Must be TIMER0_OVF_vect (megaAVR). TIM0_OVF_vect is the ATtiny spelling
      // and would leave the real vector as __bad_interrupt → reset loop.
      expect(code).toContain("ISR(TIMER0_OVF_vect)");
      expect(code).not.toContain("TIM0_OVF_vect");
      expect(code).toContain("_tc_millis_count");
      expect(code).toContain("_tc_overflow_count");
    });

    it("millis() reads the soft counter atomically (cli + SREG restore)", () => {
      setActiveChip(ATMEGA328P);
      const code = millisCode(PROGRAM);
      // The 32-bit volatile counter is ISR-owned; millis() must disable
      // interrupts before reading it to avoid a torn read on 8-bit AVR.
      expect(code).toMatch(/unsigned long millis\(\)/);
      expect(code).toMatch(/uint8_t oldSREG = SREG/);
      expect(code).toMatch(/cli\(\)/);
      expect(code).toMatch(/SREG = oldSREG/);
      // Soft counter is returned as-is (milliseconds), not multiplied by cycle math.
      expect(code).toMatch(/m = _tc_millis_count;/);
      expect(code).not.toMatch(/_tc_millis_count \* .*256/);
    });

    it("ISR accumulates milliseconds with Arduino-style fractional correction", () => {
      setActiveChip(ATMEGA328P);
      const code = millisCode(PROGRAM);
      // 16 MHz / presc 64 → 1024 us/overflow → MILLIS_INC=1, FRACT_INC=3, FRACT_MAX=125
      expect(code).toContain("m += 1;");
      expect(code).toContain("f += 3;");
      expect(code).toContain("if (f >= 125)");
      expect(code).toContain("_tc_millis_fract");
    });

    it("micros() reads TCNT0 for sub-overflow precision with a TIFR0 race fix", () => {
      setActiveChip(ATMEGA328P);
      const code = millisCode(PROGRAM);
      expect(code).toMatch(/unsigned long micros\(\)/);
      expect(code).toContain("TCNT0");
      expect(code).toContain("_tc_overflow_count");
      // The race fix: if an overflow is pending (TOV0) but TCNT0 already
      // wrapped past 255, increment the overflow count.
      expect(code).toContain("TIFR0 & _BV(TOV0)");
      // 16 MHz / presc 64 → 4 us per timer tick
      expect(code).toContain("((m << 8) + t) * 4UL");
    });

    it("emits _init_millis() that configures Timer0 fast PWM + overflow IRQ", () => {
      setActiveChip(ATMEGA328P);
      const code = millisCode(PROGRAM);
      expect(code).toContain("_init_millis()");
      // Fast PWM (WGM01|WGM00) matches Timer0 PWM init and keeps TOV0 at 256 ticks.
      expect(code).toContain("(1 << WGM01) | (1 << WGM00)");
      expect(code).toContain("TIMSK0 = (1 << TOIE0)");
      expect(code).toContain("(1 << CS01) | (1 << CS00)");
      // sei() must live inside _init_millis (polyfill), not bare-metal main:
      // the emit pipeline strips shim lines containing the substring "millis()",
      // which previously dropped both _init_millis() and sei() from main.
      expect(code).toMatch(/TIMSK0 = \(1 << TOIE0\);\s*sei\(\);/s);
    });

    it("always emits native definitions (no ARDUINO guard — bare-metal main() prevents core linking)", () => {
      setActiveChip(ATMEGA328P);
      const code = millisCode(PROGRAM);
      // The bare-metal main() always emits (the expect test harness now
      // routes output through _uart_* via OutputShim, not Serial), so the
      // Arduino core is never linked. No #ifndef ARDUINO guard needed.
      expect(code).not.toContain("#ifndef ARDUINO");
      expect(code).toContain("static inline unsigned long millis()");
      expect(code).toMatch(/_init_millis\(\)/);
    });
  });

  describe("ATmega2560 (same Timer0, different chip)", () => {
    it("emits the same overflow vector (TIMER0_OVF_vect) for the 2560", () => {
      setActiveChip(ATMEGA2560);
      const code = millisCode(PROGRAM);
      expect(code).toContain("ISR(TIMER0_OVF_vect)");
    });
  });

  describe("Timer0 PWM init matches millis overflow period", () => {
    it("328P timer0 initCode uses fast PWM (WGM01|WGM00), not phase-correct alone", () => {
      expect(ATMEGA328P.timers.timer0.initCode).toContain("WGM01");
      expect(ATMEGA328P.timers.timer0.initCode).toContain("WGM00");
    });

    it("2560 timer0 initCode uses fast PWM (WGM01|WGM00)", () => {
      expect(ATMEGA2560.timers.timer0.initCode).toContain("WGM01");
      expect(ATMEGA2560.timers.timer0.initCode).toContain("WGM00");
    });
  });

  describe("setupInitCode wires the millis backbone", () => {
    it("calls _init_millis() so the Timer0 ISR is configured", () => {
      setActiveChip(ATMEGA328P);
      const lines = new NativeAVRStrategy().setupInitCode!(PROGRAM, undefined as any);
      expect(lines).toContain("_init_millis()");
      // sei() is called in main() after _init_millis and the startup delay,
      // so millis() is live during setup() without ISR-induced UART stalls.
    });
  });

  describe("generateNativePolyfills includes timer support", () => {
    it("returns timer_methods polyfill from the parent (for setInterval/setTimeout)", () => {
      setActiveChip(ATMEGA328P);
      const polyfills = new NativeAVRStrategy().generateNativePolyfills(PROGRAM, undefined as any);
      const ids = polyfills.map(p => p.id);
      // The timer_methods polyfill (defining __tc_TimerRuntime) must be present
      // so setInterval/setTimeout are backed by a scheduler.
      expect(ids).toContain("timer_methods");
    });

    it("includes the native_millis polyfill when ctx is unavailable (defensive default)", () => {
      // When no PlatformContext is supplied (e.g. direct strategy unit tests,
      // or code paths that predate analysis), the strategy can't read usage
      // flags. It emits native_millis defensively to avoid silently dropping
      // the Timer0 ISR from a program that needs it.
      setActiveChip(ATMEGA328P);
      const polyfills = new NativeAVRStrategy().generateNativePolyfills(PROGRAM, undefined as any);
      expect(polyfills.map(p => p.id)).toContain("native_millis");
    });
  });

  // ── Usage gating: native_millis is emitted only when timing is used ─────
  // A trivial program (no delay/millis/micros/setInterval/async/UI) must not
  // pull in the Timer0 ISR. This is the regression guard for the ~400-line
  // uncalled-code bug: led.toggle() must not emit native_millis.
  describe("usage gating on timing", () => {
    function ctxFor(program: ProgramIR): PlatformContext {
      const strategy = new NativeAVRStrategy();
      const analysis = analyzeProgram(program, strategy);
      return { frameworkData: { buildTarget: "arduino:avr:uno" }, analysis } as any as PlatformContext;
    }

    it("omits native_millis when the program uses no timing", () => {
      setActiveChip(ATMEGA328P);
      const program = buildProgramIR("test.ts",
        `import { D13 } from '@typecad/board-arduino-uno';
         const led = D13.asOutput();
         led.toggle();`) as any as ProgramIR;
      const ctx = ctxFor(program);
      const polyfills = new NativeAVRStrategy().generateNativePolyfills(program, ctx);
      expect(polyfills.map(p => p.id)).not.toContain("native_millis");
    });

    it("does not call _init_millis() in setupInitCode when timing is unused", () => {
      setActiveChip(ATMEGA328P);
      const program = buildProgramIR("test.ts",
        `import { D13 } from '@typecad/board-arduino-uno';
         const led = D13.asOutput();
         led.toggle();`) as any as ProgramIR;
      const ctx = ctxFor(program);
      const lines = new NativeAVRStrategy().setupInitCode!(program, ctx);
      expect(lines).not.toContain("_init_millis()");
    });

    it("emits native_millis when the program calls delay()", () => {
      setActiveChip(ATMEGA328P);
      const program = buildProgramIR("test.ts", `delay(100);`) as any as ProgramIR;
      const ctx = ctxFor(program);
      const polyfills = new NativeAVRStrategy().generateNativePolyfills(program, ctx);
      expect(polyfills.map(p => p.id)).toContain("native_millis");
    });
  });
});
