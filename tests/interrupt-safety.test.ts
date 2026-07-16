// ---------------------------------------------------------------------------
// Tests for interrupt safety analysis
//
// Interrupt safety analysis previously relied on cuttlefish-call IR nodes to detect
// attachInterrupt calls and scan ISR callbacks for unsafe operations. In the
// __EMIT__ system, interrupt handlers may be emitted as regular call nodes or
// __EMIT__ nodes. These tests verify the current behavior.
//
// Note: the `duplicate-interrupt-handler` detector is a stub with no emitter, so
// it can only be covered negatively. The `interrupt-unsafe-operation` detector is
// live and is covered both negatively (below) and positively.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpile } from './setup';

describe('Interrupt Safety Analysis', () => {
  describe('Duplicate Interrupt Handler Detection', () => {
    it('does not generate false duplicate handler warnings for different pins', () => {
      const result = transpile(`
        import { D2, D3 } from '@typecad/board-arduino-uno';
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
        import { D2, D3 } from '@typecad/board-arduino-uno';
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
        import { D2, D13 } from '@typecad/board-arduino-uno';
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
        import { delay } from '@typecad/board-arduino-uno';
        delay(1000);
      `, { target: 'arduino' });

      const unsafeWarnings = result.diagnostics.filter(
        d => d.code === 'interrupt-unsafe-operation'
      );

      expect(unsafeWarnings.length).toBe(0);
    });

    // Positive coverage: a blocking call (delay) inside an ISR must be flagged.
    // Without a positive case the validator above could be deleted and the
    // "length === 0" assertions would still pass.
    it('flags delay() used inside an ISR callback (interrupt-unsafe-operation)', () => {
      const result = transpile(`
        import { D2 } from '@typecad/board-arduino-uno';
        D2.asInput().onFalling(() => { delay(100); });
      `, { target: 'arduino' });

      const unsafeWarnings = result.diagnostics.filter(
        d => d.code === 'interrupt-unsafe-operation'
      );

      expect(unsafeWarnings.length).toBe(1);
      expect(unsafeWarnings[0].severity).toBe('warning');
      expect(unsafeWarnings[0].message).toContain('delay');
    });
  });
});
