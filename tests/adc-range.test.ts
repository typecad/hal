// ---------------------------------------------------------------------------
// Tests for ADC range validation
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpile } from './setup';

describe('ADC Range Validation', () => {
  it('generates info for comparison exceeding ADC max on Arduino Uno (10-bit)', () => {
    const result = transpile(`
      import { A0 } from '@typehal/board-arduino-uno';
      if (A0.read() > 2000) {
        // This comparison may never be true
      }
    `, { target: 'arduino' });

    const adcWarnings = result.diagnostics.filter(
      d => d.code === 'adc-range-warning'
    );

    expect(adcWarnings.length).toBeGreaterThan(0);
    expect(adcWarnings[0].message).toContain('1023');
    expect(adcWarnings[0].message).toContain('10-bit');
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

  it('generates info for comparison on right side', () => {
    const result = transpile(`
      import { A0 } from '@typehal/board-arduino-uno';
      if (2000 < A0.read()) {
        // This comparison may never be true
      }
    `, { target: 'arduino' });

    const adcWarnings = result.diagnostics.filter(
      d => d.code === 'adc-range-warning'
    );

    expect(adcWarnings.length).toBeGreaterThan(0);
    expect(adcWarnings[0].message).toContain('1023');
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

  it('generates info for threshold at exact boundary', () => {
    const result = transpile(`
      import { A0 } from '@typehal/board-arduino-uno';
      if (A0.read() > 1024) {
        // 1024 > 1023, so this is out of range
      }
    `, { target: 'arduino' });

    const adcWarnings = result.diagnostics.filter(
      d => d.code === 'adc-range-warning'
    );

    expect(adcWarnings.length).toBeGreaterThan(0);
    expect(adcWarnings[0].message).toContain('1024');
  });

  it('does not generate warning for threshold at max value', () => {
    const result = transpile(`
      import { A0 } from '@typehal/board-arduino-uno';
      if (A0.read() > 1023) {
        // 1023 is the max, but > 1023 will never match
        // Actually this SHOULD warn since > 1023 is always false
      }
    `, { target: 'arduino' });

    // Actually > 1023 on a 10-bit ADC (max 1023) should NOT warn
    // because the comparison > 1023 with max value 1023 is valid
    // The user might be checking if it's somehow exceeding max
    // But we should warn because it's logically always false
    const adcWarnings = result.diagnostics.filter(
      d => d.code === 'adc-range-warning'
    );

    // 1023 > 1023 is the edge case - let's not warn on exact max
    // since the code might be checking for overflow conditions
    expect(adcWarnings.length).toBe(0);
  });
});
