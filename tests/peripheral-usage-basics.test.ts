// ---------------------------------------------------------------------------
// Peripheral Usage Analysis Tests: Defaults and Edge Cases
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { createEmptyPeripheralUsage } from '../packages/cli/src/ir/peripheral-usage';
import { analyzeUsage } from './setup';

describe('Peripheral Usage Analysis - Defaults and Edge Cases', () => {
  describe('Empty Usage', () => {
    it('returns empty usage for a program without peripherals', () => {
      const usage = analyzeUsage(`
        function add(a: number, b: number): number {
          return a + b;
        }
      `);

      expect(usage.i2c).toBe(false);
      expect(usage.spi).toBe(false);
      expect(usage.uart).toBe(false);
      expect(usage.adc).toBe(false);
      expect(usage.pwm).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('handles an empty program', () => {
      const usage = analyzeUsage('');

      expect(usage.i2c).toBe(false);
      expect(usage.spi).toBe(false);
      expect(usage.uart).toBe(false);
    });

    it('createEmptyPeripheralUsage returns the expected defaults', () => {
      const usage = createEmptyPeripheralUsage();

      expect(usage.adc).toBe(false);
      expect(usage.pwm).toBe(false);
      expect(usage.externalInterrupts).toBe(false);
      expect(usage.timer0).toBe(false);
      expect(usage.i2c).toBe(false);
      expect(usage.spi).toBe(false);
      expect(usage.uart).toBe(false);
      expect(usage.pwmPinsUsed).toBeInstanceOf(Set);
      expect(usage.adcChannelsUsed).toBeInstanceOf(Set);
      expect(usage.outputPins).toBeInstanceOf(Set);
      expect(usage.inputPullupPins).toBeInstanceOf(Set);
      expect(usage.inputPins).toBeInstanceOf(Set);
      expect(usage.i2cInstancesUsed).toBeInstanceOf(Set);
      expect(usage.spiInstancesUsed).toBeInstanceOf(Set);
      expect(usage.uartInstancesUsed).toBeInstanceOf(Set);
    });

    it('tracks timer0 usage for delay()', () => {
      const usage = analyzeUsage(`
        import { delay } from '@typehal/board-arduino-uno';
        delay(10);
      `);

      expect(usage.timer0).toBe(true);
    });

    it('tracks timer0 usage for millis() in expressions', () => {
      const usage = analyzeUsage(`
        import { millis } from '@typehal/board-arduino-uno';
        const now = millis();
      `);

      expect(usage.timer0).toBe(true);
    });
  });
});