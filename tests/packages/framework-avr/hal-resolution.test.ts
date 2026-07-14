import { describe, it, expect } from "vitest";
import { NativeAVRStrategy } from "../../../packages/framework-avr/src/strategy";
import type { HALOpIR } from "@typecad/cuttlefish/api/shared";

// framework-avr's reason to exist as a sibling of framework-arduino is bare-metal
// register access — D13.high() must become `PORTB |= 0x20`, not `digitalWrite(13, HIGH)`.
// Before this override existed, NativeAVRStrategy did NOT override resolveHALOperation,
// so every GPIO/PWM/ADC op silently fell through to the parent Arduino strategy and
// emitted Wiring calls. These tests pin the register-level translation and guard the
// Phase-1 chip-descriptor refactor (outputs must stay byte-identical).

describe("NativeAVRStrategy.resolveHALOperation emits AVR register access", () => {
  const s = new NativeAVRStrategy();
  const resolve = (op: HALOpIR) => s.resolveHALOperation!(op);

  describe("gpio on D13 (Port B, bit 5, mask 0x20)", () => {
    it("set_mode output writes the DDR bit", () => {
      const out = resolve({ operation: "gpio.set_mode", pin: 13, mode: "output" });
      expect(out).toEqual({ code: "DDRB |= 0x20;" });
    });

    it("set_mode input_pullup clears DDR and sets PORT", () => {
      const out = resolve({ operation: "gpio.set_mode", pin: 13, mode: "input_pullup" });
      expect(out).toEqual({ code: "DDRB &= ~0x20; PORTB |= 0x20;" });
    });

    it("write HIGH sets the PORT bit", () => {
      const out = resolve({ operation: "gpio.write", pin: 13, value: 1 });
      expect(out).toEqual({ code: "PORTB |= 0x20;" });
    });

    it("write LOW clears the PORT bit", () => {
      const out = resolve({ operation: "gpio.write", pin: 13, value: 0 });
      expect(out).toEqual({ code: "PORTB &= ~0x20;" });
    });

    it("write with a runtime expression emits a branchless read-modify-write (not a side-effecting ternary)", () => {
      const out = resolve({ operation: "gpio.write", pin: 13, value: "state" });
      expect(out).toEqual({ code: "PORTB = (PORTB & ~0x20) | ((state) ? 0x20 : 0);" });
    });

    it("read returns a PIN register expression", () => {
      const out = resolve({ operation: "gpio.read", pin: 13 });
      expect(out).toEqual({ expression: "((PINB & 0x20) ? 1 : 0)" });
    });

    it("toggle writes to PINx (AVR toggling idiom)", () => {
      const out = resolve({ operation: "gpio.toggle", pin: 13 });
      expect(out).toEqual({ code: "PINB |= 0x20;" });
    });
  });

  describe("adc on A0 (ADC channel 0)", () => {
    it("read returns an ADMUX/ADC statement expression", () => {
      const out = resolve({ operation: "adc.read", pin: 14 }); // A0 = D14
      // GCC statement expression: select channel, start, wait, return ADC.
      expect(out?.expression).toMatch(/ADMUX = \(1 << REFS0\) \| 0/);
      expect(out?.expression).toMatch(/ADCSRA \|= \(1 << ADSC\)/);
      expect(out?.expression).toMatch(/while \(ADCSRA & \(1 << ADSC\)\)/);
      // Returns the ADC data register as the expression's value. The GCC
      // statement expression closes as `... ADC; })`.
      expect(out?.expression).toMatch(/ADC;\s*}\)/);
    });
  });

  describe("pwm.write sets the OCR register (timer init is separate)", () => {
    it("D11 -> OCR2A", () => {
      const out = resolve({ operation: "pwm.write", pin: 11, duty: 128 });
      expect(out).toEqual({ code: "OCR2A = 128;" });
    });

    it("D3 -> OCR2B with an expression duty", () => {
      const out = resolve({ operation: "pwm.write", pin: 3, duty: "duty" });
      expect(out).toEqual({ code: "OCR2B = duty;" });
    });
  });

  describe("unhandled ops fall through to the parent Arduino strategy", () => {
    it("timing.delay resolves via super (not undefined)", () => {
      const out = resolve({ operation: "timing.delay", ms: 500 });
      // Parent lowers timing.delay to delay(). The point is it is NOT undefined
      // — we delegate rather than dropping the op.
      expect(out).toBeDefined();
      expect(out?.code ?? out?.expression).toBeTruthy();
    });
  });
});
