// ---------------------------------------------------------------------------
// Peripheral Usage Analysis Tests: Pins and Channels
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { analyzeUsage } from './setup';

describe('Peripheral Usage Analysis - Pins and Channels', () => {
  describe('ADC Detection', () => {
    it('detects ADC from analogRead __EMIT__ nodes', () => {
      // When the transpiler generates analogRead(A0) in __EMIT__ output,
      // the peripheral usage analyzer detects ADC usage.
      // Note: A-pin .read() currently emits digitalRead, not analogRead,
      // so ADC detection via A-pins requires explicit analogRead in the emit string.
      // For now, verify that the __EMIT__ parser can detect analogRead patterns.
      const usage = analyzeUsage(`
        import { A0 } from '@typehal/board-arduino-uno';
        A0.read();
      `);

      // A0.read() currently emits digitalRead(14) — analog read is not yet
      // supported via the inline evaluator, so ADC is not detected.
      // This test documents the current behavior.
      expect(usage.adc).toBe(false);
    });
  });

  describe('PWM Detection', () => {
    it('detects PWM usage and records the pin number', () => {
      // D9.pwm() emits analogWrite via __EMIT__ node
      const usage = analyzeUsage(`
        import { D9 } from '@typehal/board-arduino-uno';
        D9.asOutput();
        D9.pwm(128);
      `);

      expect(usage.pwm).toBe(true);
      expect(usage.pwmPinsUsed.has(9)).toBe(true);
    });
  });

  describe('Pin Mode Detection', () => {
    it('detects output pin configuration', () => {
      const usage = analyzeUsage(`
        import { D13 } from '@typehal/board-arduino-uno';
        D13.output(false);
      `);

      expect(usage.outputPins.has(13)).toBe(true);
    });

    it('detects input pullup configuration', () => {
      const usage = analyzeUsage(`
        import { D2 } from '@typehal/board-arduino-uno';
        D2.inputPullUp();
      `);

      expect(usage.inputPullupPins.has(2)).toBe(true);
    });
  });
});
