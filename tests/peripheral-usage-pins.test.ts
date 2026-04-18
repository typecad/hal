// ---------------------------------------------------------------------------
// Peripheral Usage Analysis Tests: Pins and Channels
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { analyzeUsage } from './setup';

describe('Peripheral Usage Analysis - Pins and Channels', () => {
  describe('ADC Detection', () => {
    it('detects analog input read', () => {
      const usage = analyzeUsage(`
        import { A0 } from '@typecode/board-arduino-uno';
        const value = A0.read();
      `);

      expect(usage.adc).toBe(true);
      expect(usage.adcChannelsUsed.has(0)).toBe(true);
    });

    it('detects multiple ADC channels', () => {
      const usage = analyzeUsage(`
        import { A0, A1, A2 } from '@typecode/board-arduino-uno';
        const v0 = A0.read();
        const v1 = A1.read();
        const v2 = A2.read();
      `);

      expect(usage.adc).toBe(true);
      expect(usage.adcChannelsUsed.has(0)).toBe(true);
      expect(usage.adcChannelsUsed.has(1)).toBe(true);
      expect(usage.adcChannelsUsed.has(2)).toBe(true);
    });
  });

  describe('PWM Detection', () => {
    it('detects PWM usage and records the pin number', () => {
      const usage = analyzeUsage(`
        import { D9 } from '@typecode/board-arduino-uno';
        D9.asOutput();
        D9.write(128);
      `);

      expect(usage.pwm).toBe(true);
      expect(usage.pwmPinsUsed.has(9)).toBe(true);
      expect(usage.pinsUsed.has('D9')).toBe(true);
    });
  });

  describe('Pin Mode Detection', () => {
    it('detects output pin configuration', () => {
      const usage = analyzeUsage(`
        import { D13 } from '@typecode/board-arduino-uno';
        D13.output(false);
      `);

      expect(usage.outputPins.has(13)).toBe(true);
    });

    it('detects input pullup configuration', () => {
      const usage = analyzeUsage(`
        import { D2 } from '@typecode/board-arduino-uno';
        D2.inputPullUp();
      `);

      expect(usage.inputPullupPins.has(2)).toBe(true);
    });
  });
});