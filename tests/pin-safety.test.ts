// ---------------------------------------------------------------------------
// Tests for unsafe pin validation
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpile } from './setup';

describe('Pin Safety Validation', () => {
  it('generates warning when unsafe pin D0 is used', () => {
    const result = transpile(`
      import { D0, HIGH } from '@typecode/board-arduino-uno';
      D0.config.output();
      D0.write(HIGH);
    `, { target: 'arduino' });

    const unsafeWarnings = result.diagnostics.filter(
      d => d.code === 'unsafe-pin-usage'
    );

    expect(unsafeWarnings.length).toBeGreaterThan(0);
    expect(unsafeWarnings[0].message).toContain('D0');
    expect(unsafeWarnings[0].severity).toBe('warning');
  });

  it('generates warning when unsafe pin D1 is used', () => {
    const result = transpile(`
      import { D1, HIGH } from '@typecode/board-arduino-uno';
      D1.config.output();
      D1.write(HIGH);
    `, { target: 'arduino' });

    const unsafeWarnings = result.diagnostics.filter(
      d => d.code === 'unsafe-pin-usage'
    );

    expect(unsafeWarnings.length).toBeGreaterThan(0);
    expect(unsafeWarnings[0].message).toContain('D1');
  });

  it('does not generate warning for safe pins', () => {
    const result = transpile(`
      import { D13, HIGH } from '@typecode/board-arduino-uno';
      D13.config.output();
      D13.write(HIGH);
    `, { target: 'arduino' });

    const unsafeWarnings = result.diagnostics.filter(
      d => d.code === 'unsafe-pin-usage'
    );

    expect(unsafeWarnings.length).toBe(0);
  });

  it('does not generate warning for PWM pins that are not unsafe', () => {
    const result = transpile(`
      import { D9 } from '@typecode/board-arduino-uno';
      D9.config.pwm();
      D9.pwm(128);
    `, { target: 'arduino' });

    const unsafeWarnings = result.diagnostics.filter(
      d => d.code === 'unsafe-pin-usage'
    );

    expect(unsafeWarnings.length).toBe(0);
  });
});
