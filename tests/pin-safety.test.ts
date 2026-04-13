// ---------------------------------------------------------------------------
// Tests for unsafe pin validation
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpile } from './setup';

describe('Pin Safety Validation', () => {
  it('generates warning when unsafe pin D0 is used', () => {
    const result = transpile(`
      import { D0 } from '@typecode/board-arduino-uno';
      D0.output();
      D0.high();
    `, { target: 'arduino' });

    const unsafeWarnings = result.diagnostics.filter(
      d => d.code === 'unsafe-pin-usage'
    );

    expect(unsafeWarnings.length).toBeGreaterThan(0);
    expect(unsafeWarnings[0].message).toContain('D0');
    expect(unsafeWarnings[0].message).toContain('Serial');
    expect(unsafeWarnings[0].severity).toBe('warning');
  });

  it('generates warning when unsafe pin D1 is used', () => {
    const result = transpile(`
      import { D1 } from '@typecode/board-arduino-uno';
      D1.output();
      D1.high();
    `, { target: 'arduino' });

    const unsafeWarnings = result.diagnostics.filter(
      d => d.code === 'unsafe-pin-usage'
    );

    expect(unsafeWarnings.length).toBeGreaterThan(0);
    expect(unsafeWarnings[0].message).toContain('D1');
  });

  it('generates warning when unsafe pin alias TX is used', () => {
    const result = transpile(`
      import { TX } from '@typecode/board-arduino-uno';
      TX.output();
      TX.high();
    `, { target: 'arduino' });

    const unsafeWarnings = result.diagnostics.filter(
      d => d.code === 'unsafe-pin-usage'
    );

    expect(unsafeWarnings.length).toBeGreaterThan(0);
    expect(unsafeWarnings[0].message).toContain('TX');
    expect(unsafeWarnings[0].message).toContain('D1');
  });

  it('does not generate warning for safe pins', () => {
    const result = transpile(`
      import { D13 } from '@typecode/board-arduino-uno';
      D13.output();
      D13.high();
    `, { target: 'arduino' });

    const unsafeWarnings = result.diagnostics.filter(
      d => d.code === 'unsafe-pin-usage'
    );

    expect(unsafeWarnings.length).toBe(0);
  });

  it('does not generate warning for PWM pins that are not unsafe', () => {
    const result = transpile(`
      import { D9 } from '@typecode/board-arduino-uno';
      D9.pwm();
      D9.pwm(128);
    `, { target: 'arduino' });

    const unsafeWarnings = result.diagnostics.filter(
      d => d.code === 'unsafe-pin-usage'
    );

    expect(unsafeWarnings.length).toBe(0);
  });
});
