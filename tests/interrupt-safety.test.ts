// ---------------------------------------------------------------------------
// Tests for interrupt safety analysis
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpile } from './setup';

describe('Interrupt Safety Analysis', () => {
  describe('Duplicate Interrupt Handler Detection', () => {
    it('generates warning when multiple handlers attached to same pin', () => {
      const result = transpile(`
        import { D2 } from '@typecode/board-arduino-uno';
        D2.attachInterrupt(() => {}, 'RISING');
        D2.attachInterrupt(() => {}, 'FALLING');
      `, { target: 'arduino' });

      const duplicateWarnings = result.diagnostics.filter(
        d => d.code === 'duplicate-interrupt-handler'
      );

      expect(duplicateWarnings.length).toBeGreaterThan(0);
      expect(duplicateWarnings[0].message).toContain('D2');
      expect(duplicateWarnings[0].message).toContain('already has');
    });

    it('does not generate warning for different pins', () => {
      const result = transpile(`
        import { D2, D3 } from '@typecode/board-arduino-uno';
        D2.attachInterrupt(() => {}, 'RISING');
        D3.attachInterrupt(() => {}, 'RISING');
      `, { target: 'arduino' });

      const duplicateWarnings = result.diagnostics.filter(
        d => d.code === 'duplicate-interrupt-handler'
      );

      expect(duplicateWarnings.length).toBe(0);
    });

    it('generates warning for D2.onFalling + D2.onRising on the same pin (flat API)', () => {
      const result = transpile(`
        import { D2 } from '@typecode/board-arduino-uno';
        D2.onFalling(() => {});
        D2.onRising(() => {});
      `, { target: 'arduino' });

      const duplicateWarnings = result.diagnostics.filter(
        d => d.code === 'duplicate-interrupt-handler'
      );

      expect(duplicateWarnings.length).toBeGreaterThan(0);
      expect(duplicateWarnings[0].message).toContain('D2');
      expect(duplicateWarnings[0].message).toContain('already has');
    });

    it('does not warn for onFalling on D2 and onRising on D3 (different pins, flat API)', () => {
      const result = transpile(`
        import { D2, D3 } from '@typecode/board-arduino-uno';
        D2.onFalling(() => {});
        D3.onRising(() => {});
      `, { target: 'arduino' });

      const duplicateWarnings = result.diagnostics.filter(
        d => d.code === 'duplicate-interrupt-handler'
      );

      expect(duplicateWarnings.length).toBe(0);
    });
  });

  describe('Unsafe Operations in ISR', () => {
    it('generates warning for delay() in interrupt handler', () => {
      const result = transpile(`
        import { D2, delay } from '@typecode/board-arduino-uno';
        D2.attachInterrupt(() => {
          delay(100);
        }, 'RISING');
      `, { target: 'arduino' });

      const unsafeWarnings = result.diagnostics.filter(
        d => d.code === 'interrupt-unsafe-operation'
      );

      expect(unsafeWarnings.length).toBeGreaterThan(0);
      expect(unsafeWarnings[0].message).toContain('delay');
      expect(unsafeWarnings[0].message).toContain('interrupt');
    });

    it('generates info for Serial.print() in interrupt handler', () => {
      const result = transpile(`
        import { D2, Serial } from '@typecode/board-arduino-uno';
        D2.attachInterrupt(() => {
          Serial.println("ISR triggered");
        }, 'RISING');
      `, { target: 'arduino' });

      const unsafeWarnings = result.diagnostics.filter(
        d => d.code === 'interrupt-unsafe-operation'
      );

      expect(unsafeWarnings.length).toBeGreaterThan(0);
      expect(unsafeWarnings[0].message).toContain('Serial');
    });

    it('does not generate warning for safe operations in ISR', () => {
      const result = transpile(`
        import { D2, D13 } from '@typecode/board-arduino-uno';
        let counter = 0;
        D2.attachInterrupt(() => {
          counter++;
          D13.toggle();
        }, 'RISING');
      `, { target: 'arduino' });

      const unsafeWarnings = result.diagnostics.filter(
        d => d.code === 'interrupt-unsafe-operation'
      );

      expect(unsafeWarnings.length).toBe(0);
    });

    it('does not generate warning for delay() outside ISR', () => {
      const result = transpile(`
        import { delay } from '@typecode/board-arduino-uno';
        delay(1000);
      `, { target: 'arduino' });

      const unsafeWarnings = result.diagnostics.filter(
        d => d.code === 'interrupt-unsafe-operation'
      );

      expect(unsafeWarnings.length).toBe(0);
    });
  });
});
