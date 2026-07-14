import { describe, it, expect } from "vitest";
import { NativeAVRStrategy } from "../../../packages/framework-avr/src/strategy";
import { ATMEGA328P, ATMEGA2560, setActiveChip } from "../../../packages/framework-avr/src/chips/index.js";
import type { ProgramIR } from "@typecad/cuttlefish/api/shared";

// Native millis()/micros() via Timer0 overflow ISR.
//
// Before this work, framework-avr depended on millis()/micros() from the
// Arduino core (wiring.c) — a contradiction for a "no Arduino core" framework.
// The strategy now emits its own Timer0 ISR + atomic millis()/micros() in a
// native_millis polyfill (not shimLines, because the emit pipeline filters
// shim lines containing 'millis()'). Driven by the chip descriptor's
// millisTimer config. These tests pin the generated C++ at the string level.

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
    it("emits the Timer0 overflow ISR with the chip's overflow vector", () => {
      setActiveChip(ATMEGA328P);
      const code = millisCode(PROGRAM);
      expect(code).toContain("ISR(TIM0_OVF_vect)");
      expect(code).toContain("_tc_millis_count++");
    });

    it("millis() reads the overflow counter atomically (cli + SREG restore)", () => {
      setActiveChip(ATMEGA328P);
      const code = millisCode(PROGRAM);
      // The 32-bit volatile counter is ISR-owned; millis() must disable
      // interrupts before reading it to avoid a torn read on 8-bit AVR.
      expect(code).toMatch(/unsigned long millis\(\)/);
      expect(code).toMatch(/uint8_t oldSREG = SREG/);
      expect(code).toMatch(/cli\(\)/);
      expect(code).toMatch(/SREG = oldSREG/);
    });

    it("millis() math uses the descriptor prescaler (64) and F_CPU", () => {
      setActiveChip(ATMEGA328P);
      const code = millisCode(PROGRAM);
      // overflow_count * prescaler * 256 / (F_CPU / 1000000) = ms
      expect(code).toContain("64UL * 256UL");
      expect(code).toContain("F_CPU / 1000000UL");
    });

    it("micros() reads TCNT0 for sub-overflow precision with a TIFR0 race fix", () => {
      setActiveChip(ATMEGA328P);
      const code = millisCode(PROGRAM);
      expect(code).toMatch(/unsigned long micros\(\)/);
      expect(code).toContain("TCNT0");
      // The race fix: if an overflow is pending (TOV0) but TCNT0 already
      // wrapped past 255, increment the overflow count.
      expect(code).toContain("TIFR0 & _BV(TOV0)");
    });

    it("emits _init_millis() that configures Timer0 normal mode + overflow IRQ", () => {
      setActiveChip(ATMEGA328P);
      const code = millisCode(PROGRAM);
      expect(code).toContain("_init_millis()");
      expect(code).toContain("TCCR0A = 0");
      expect(code).toContain("TIMSK0 = (1 << TOIE0)");
    });

    it("guards the native definitions with #ifndef ARDUINO", () => {
      setActiveChip(ATMEGA328P);
      const code = millisCode(PROGRAM);
      // When the Arduino core is linked (arduino-cli builds), the core's
      // millis()/micros() and Timer0 ISR are used; our definitions would
      // cause a multiple-definition link error. The guard makes _init_millis
      // a no-op in that case.
      expect(code).toContain("#ifndef ARDUINO");
      expect(code).toContain("#else");
      expect(code).toMatch(/_init_millis\(\) \{\}/);
    });
  });

  describe("ATmega2560 (same Timer0, different chip)", () => {
    it("emits the same overflow vector (TIM0_OVF_vect) for the 2560", () => {
      setActiveChip(ATMEGA2560);
      const code = millisCode(PROGRAM);
      expect(code).toContain("ISR(TIM0_OVF_vect)");
    });
  });

  describe("setupInitCode wires the millis backbone", () => {
    it("calls _init_millis() and sei() so the ISR begins firing", () => {
      setActiveChip(ATMEGA328P);
      const lines = new NativeAVRStrategy().setupInitCode!(PROGRAM, undefined as any);
      expect(lines).toContain("_init_millis()");
      expect(lines).toContain("sei()");
      // _init_millis must come before sei (init the timer, then enable IRQs).
      expect(lines.indexOf("_init_millis()")).toBeLessThan(lines.indexOf("sei()"));
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

    it("always includes the native_millis polyfill", () => {
      setActiveChip(ATMEGA328P);
      const polyfills = new NativeAVRStrategy().generateNativePolyfills(PROGRAM, undefined as any);
      expect(polyfills.map(p => p.id)).toContain("native_millis");
    });
  });
});
