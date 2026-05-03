// ---------------------------------------------------------------------------
// Tests for interrupt safety analysis
//
// Interrupt safety analysis previously relied on typehal-call IR nodes to detect
// attachInterrupt calls and scan ISR callbacks for unsafe operations. In the
// __EMIT__ system, interrupt handlers may be emitted as regular call nodes or
// __EMIT__ nodes. These tests verify the current behavior.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpile } from './setup';

describe('Interrupt Safety Analysis', () => {
  describe('Duplicate Interrupt Handler Detection', () => {
    it('does not generate false duplicate handler warnings for different pins', () => {
      const result = transpile(`
        import { D2, D3 } from '@typehal/board-arduino-uno';
        D2.attachInterrupt(() => {}, 'RISING');
        D3.attachInterrupt(() => {}, 'RISING');
      `, { target: 'arduino' });

      const duplicateWarnings = result.diagnostics.filter(
        d => d.code === 'duplicate-interrupt-handler'
      );

      expect(duplicateWarnings.length).toBe(0);
    });

    it('does not warn for onFalling on D2 and onRising on D3 (different pins)', () => {
      const result = transpile(`
        import { D2, D3 } from '@typehal/board-arduino-uno';
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
    it('does not generate warning for safe operations in ISR', () => {
      const result = transpile(`
        import { D2, D13 } from '@typehal/board-arduino-uno';
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
        import { delay } from '@typehal/board-arduino-uno';
        delay(1000);
      `, { target: 'arduino' });

      const unsafeWarnings = result.diagnostics.filter(
        d => d.code === 'interrupt-unsafe-operation'
      );

      expect(unsafeWarnings.length).toBe(0);
    });
  });
});
