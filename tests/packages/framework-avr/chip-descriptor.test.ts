import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NativeAVRStrategy } from "../../../packages/framework-avr/src/strategy";
import { ATMEGA328P, ATMEGA2560, setActiveChip, resetActiveChip } from "../../../packages/framework-avr/src/chips/index.js";
import { getPinInfo, getPWMInfo, getInterruptInfo, isPWMPin, getADCChannel } from "../../../packages/framework-avr/src/registers";
import type { HALOpIR, AVRChipDescriptor } from "@typecad/cuttlefish/api/shared";

// The portability proof. Phase 0 tests pin the ATmega328P register translation;
// these tests swap the active chip to ATmega2560 and confirm the SAME strategy
// code emits the correct (different) registers — driven entirely by the data
// descriptor, with no chip-specific branches in strategy.ts or registers.ts.
//
// What "different" means here, and why it matters:
//  - 328P pin 13 -> PORTB bit 5 ;  2560 pin 13 -> PORTB bit 7  (different bit)
//  - 328P has 2 external interrupts (INT0/1) ; 2560 has 6+ (INT0-5)
//  - 2560 has 6 PWM timers (0-5) vs the 328P's 3, and maps PWM to more pins
//  - 2560 A0 is D54 (ADC0), not D14 as on the 328P
// If any of these differences required editing strategy.ts, the abstraction failed.

describe("chip descriptor portability", () => {
  afterEach(() => resetActiveChip());

  describe("ATmega328P (default)", () => {
    beforeEach(() => setActiveChip(ATMEGA328P));

    it("pin 13 maps to PORTB bit 5", () => {
      expect(getPinInfo(13)).toEqual({ port: "PORTB", ddr: "DDRB", pinReg: "PINB", bit: 5 });
    });

    it("has exactly 2 external interrupt pins (D2, D3)", () => {
      expect(getInterruptInfo(2)?.interrupt).toBe("INT0");
      expect(getInterruptInfo(3)?.interrupt).toBe("INT1");
      expect(getInterruptInfo(18)).toBeNull();
    });

    it("A0 is D14, ADC channel 0", () => {
      expect(getADCChannel(14)).toBe(0);
    });

    it("has 6 PWM pins", () => {
      expect([3, 5, 6, 9, 10, 11].every(isPWMPin)).toBe(true);
      expect(isPWMPin(13)).toBe(false);
    });

    it("D11 PWM uses OCR2A on timer2", () => {
      expect(getPWMInfo(11)?.ocr).toBe("OCR2A");
      expect(getPWMInfo(11)?.timerId).toBe("timer2");
    });
  });

  describe("ATmega2560 (Arduino Mega 2560)", () => {
    beforeEach(() => setActiveChip(ATMEGA2560));

    it("pin 13 maps to PORTB bit 7 (different bit from 328P)", () => {
      expect(getPinInfo(13)).toEqual({ port: "PORTB", ddr: "DDRB", pinReg: "PINB", bit: 7 });
    });

    it("has 6 external interrupt pins (INT0-INT5) — 3x the 328P", () => {
      // 328P stops at INT1; the 2560 reaches INT2-5.
      expect(getInterruptInfo(21)?.interrupt).toBe("INT0");  // PD0
      expect(getInterruptInfo(20)?.interrupt).toBe("INT1");  // PD1
      expect(getInterruptInfo(19)?.interrupt).toBe("INT2");  // PD2
      expect(getInterruptInfo(18)?.interrupt).toBe("INT3");  // PD3
      expect(getInterruptInfo(2)?.interrupt).toBe("INT4");   // PE4
      expect(getInterruptInfo(3)?.interrupt).toBe("INT5");   // PE5
    });

    it("A0 is D54 (not D14), ADC channel 0", () => {
      expect(getADCChannel(54)).toBe(0);
      expect(getADCChannel(14)).toBeNull();  // D14 is digital on the 2560
    });

    it("has 15 PWM pins across 6 timers", () => {
      // Timer4 drives pins 6,7,8 — pins that don't exist as PWM on the 328P.
      expect([6, 7, 8].every(isPWMPin)).toBe(true);
      expect(getPWMInfo(6)?.timerId).toBe("timer4");
      expect(getPWMInfo(6)?.ocr).toBe("OCR4A");
      // Timer5 (16-bit) drives pins 44-46.
      expect(getPWMInfo(46)?.timerId).toBe("timer5");
    });
  });

  describe("NativeAVRStrategy emits chip-correct HAL ops", () => {
    // The strategy instance is constructed against a specific chip; the module-
    // level activeChip is set in its constructor, so HAL resolution reflects it.
    const resolveWith = (chip: AVRChipDescriptor) => {
      const s = new NativeAVRStrategy(chip);
      return (op: HALOpIR) => s.resolveHALOperation!(op);
    };

    it("328P: gpio.write D13 HIGH -> PORTB |= 0x20", () => {
      const resolve = resolveWith(ATMEGA328P);
      expect(resolve({ operation: "gpio.write", pin: 13, value: 1 })).toEqual({ code: "PORTB |= 0x20;" });
    });

    it("2560: gpio.write D13 HIGH -> PORTB |= 0x80 (bit 7, not bit 5)", () => {
      const resolve = resolveWith(ATMEGA2560);
      expect(resolve({ operation: "gpio.write", pin: 13, value: 1 })).toEqual({ code: "PORTB |= 0x80;" });
    });

    it("2560: pwm.write D6 -> OCR4A (timer4, a timer the 328P doesn't have)", () => {
      const resolve = resolveWith(ATMEGA2560);
      expect(resolve({ operation: "pwm.write", pin: 6, duty: 200 })).toEqual({ code: "OCR4A = 200;" });
    });

    it("2560: adc.read A0 (D54) selects ADC channel 0 via ADMUX", () => {
      const resolve = resolveWith(ATMEGA2560);
      const out = resolve({ operation: "adc.read", pin: 54 });
      expect(out?.expression).toMatch(/ADMUX = \(1 << REFS0\) \| 0/);
    });
  });

  describe("descriptor data integrity", () => {
    // Sanity: the descriptors are well-formed (no dangling timer refs, etc.).
    const check = (chip: AVRChipDescriptor) => {
      for (const pin of Object.keys(chip.pwmByPin).map(Number)) {
        const pwm = chip.pwmByPin[pin];
        if (!chip.timers[pwm.timerId]) throw new Error(`${chip.id}: pin ${pin} references unknown timer ${pwm.timerId}`);
      }
    };

    it("ATmega328P: every PWM pin references a defined timer", () => {
      expect(() => check(ATMEGA328P)).not.toThrow();
    });

    it("ATmega2560: every PWM pin references a defined timer", () => {
      expect(() => check(ATMEGA2560)).not.toThrow();
    });
  });
});
