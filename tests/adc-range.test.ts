// ---------------------------------------------------------------------------
// Tests for ADC range validation
//
// ADC range validation previously relied on isAnalogRead() which detected
// typehal-call IR nodes for analog pin reads. In the __EMIT__ system, analog
// reads are lowered to C++ calls and the structured metadata is no longer
// available. These tests verify that no false ADC warnings are generated.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpile } from './setup';

describe('ADC Range Validation', () => {
  it('does not generate false warnings for ADC comparisons', () => {
    const result = transpile(`
      import { A0 } from '@typehal/board-arduino-uno';
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
      import { A0 } from '@typehal/board-arduino-uno';
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
});
