// ---------------------------------------------------------------------------
// Tests for ADC range validation
//
// ADC range validation previously relied on isAnalogRead() which detected
// cuttlefish-call IR nodes for analog pin reads. In the __EMIT__ system, analog
// reads are lowered to C++ calls and the structured metadata is no longer
// available. These tests verify that no false ADC warnings are generated.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpile } from './setup';

describe('ADC Range Validation', () => {
  it('does not generate false warnings for ADC comparisons', () => {
    const result = transpile(`
      import { A0 } from '@typecad/board-arduino-uno';
      if (A0.read() > 2000) {
        // ADC range validation not available in __EMIT__ system
      }
    `, { target: 'arduino' });

    const adcWarnings = result.diagnostics.filter(
      d => d.code === 'adc-range-warning'
    );

    expect(adcWarnings.length).toBe(0);
  });

  it('does not generate warning for comparison within ADC range', () => {
    const result = transpile(`
      import { A0 } from '@typecad/board-arduino-uno';
      if (A0.read() > 512) {
        // This is fine, 512 <= 1023
      }
    `, { target: 'arduino' });

    const adcWarnings = result.diagnostics.filter(
      d => d.code === 'adc-range-warning'
    );

    expect(adcWarnings.length).toBe(0);
  });

  it('does not generate warning for non-ADC comparisons', () => {
    const result = transpile(`
      let x = 5000;
      if (x > 2000) {
        // Not an ADC read, no warning
      }
    `, { target: 'arduino' });

    const adcWarnings = result.diagnostics.filter(
      d => d.code === 'adc-range-warning'
    );

    expect(adcWarnings.length).toBe(0);
  });

  // Positive coverage: an ADC read compared against a value beyond the board's
  // 10-bit range (> 1023) must be flagged. Without this, the negative cases
  // above would still pass if the validator were deleted.
  it('flags an ADC comparison that can never be true (> 1023 on 10-bit ADC)', () => {
    const result = transpile(`
      import { A0 } from '@typecad/board-arduino-uno';
      if (A0.asInput().readAnalog() > 2000) {
        // 2000 exceeds the 10-bit max of 1023 — this branch is unreachable
      }
    `, { target: 'arduino' });

    const adcWarnings = result.diagnostics.filter(
      d => d.code === 'adc-range-warning'
    );

    expect(adcWarnings.length).toBe(1);
    expect(adcWarnings[0].message).toContain('1023');
  });
});
