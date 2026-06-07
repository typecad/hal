// ---------------------------------------------------------------------------
// Tests for unsafe pin validation
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpile } from './setup';

// TODO: Pin safety validation is not yet generating unsafe-pin warnings.
// The transpiler does not currently emit pin-safety diagnostics for D0/D1/TX/RX.
// Re-enable when pin-safety diagnostics are implemented.
describe('Pin Safety Validation', () => {
  it('generates warning when unsafe pin D0 is used', () => {
    const result = transpile(`
      import { D0 } from '@typecad/board-arduino-uno';
      D0.asOutput();
      D0.high();
    `, { target: 'arduino' });

    const unsafeWarnings = result.diagnostics.filter(
      d => d.code === 'unsafe-pin-usage'
    );

    expect(unsafeWarnings.length).toBeGreaterThan(0);
    expect(unsafeWarnings[0].message).toContain('PD0');
    expect(unsafeWarnings[0].message).toContain('UART');
    expect(unsafeWarnings[0].severity).toBe('warning');
  });

  it('generates warning when unsafe pin D1 is used', () => {
    const result = transpile(`
      import { D1 } from '@typecad/board-arduino-uno';
      D1.asOutput();
      D1.high();
    `, { target: 'arduino' });

    const unsafeWarnings = result.diagnostics.filter(
      d => d.code === 'unsafe-pin-usage'
    );

    expect(unsafeWarnings.length).toBeGreaterThan(0);
    expect(unsafeWarnings[0].message).toContain('PD1');
  });

  it('generates warning when unsafe pin alias TX is used', () => {
    const result = transpile(`
      import { TX } from '@typecad/board-arduino-uno';
      TX.asOutput();
      TX.high();
    `, { target: 'arduino' });

    const unsafeWarnings = result.diagnostics.filter(
      d => d.code === 'unsafe-pin-usage'
    );

    expect(unsafeWarnings.length).toBeGreaterThan(0);
    // TX is an alias of PD1; the message references the MCU name.
    expect(unsafeWarnings[0].message).toContain('PD1');
  });

  it('does not generate warning for safe pins', () => {
    const result = transpile(`
      import { D13 } from '@typecad/board-arduino-uno';
      D13.asOutput();
      D13.high();
    `, { target: 'arduino' });

    const unsafeWarnings = result.diagnostics.filter(
      d => d.code === 'unsafe-pin-usage'
    );

    expect(unsafeWarnings.length).toBe(0);
  });

  it('does not generate warning for PWM pins that are not unsafe', () => {
    const result = transpile(`
      import { D9 } from '@typecad/board-arduino-uno';
      D9.pwm();
      D9.pwm(128);
    `, { target: 'arduino' });

    const unsafeWarnings = result.diagnostics.filter(
      d => d.code === 'unsafe-pin-usage'
    );

    expect(unsafeWarnings.length).toBe(0);
  });
});
