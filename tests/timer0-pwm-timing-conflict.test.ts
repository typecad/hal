import { describe, it, expect } from 'vitest';
import { transpile } from './setup';

describe('Timer0 PWM Timing Conflict Validation', () => {
  it('generates info when D5 PWM is used with delay()', () => {
    const result = transpile(`
      import { D5, delay } from '@typecad/board-arduino-uno';
      D5.pwm(50);
      delay(10);
    `, { target: 'arduino' });

    const diagnostics = result.diagnostics.filter(
      d => d.code === 'timer0-pwm-timing-conflict'
    );

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].message).toContain('PD5');
    expect(diagnostics[0].message).toContain('Timer0');
    expect(diagnostics[0].message).toContain('delay()');
    expect(diagnostics[0].severity).toBe('info');
  });

  it('generates info when D6 PWM is used with millis()', () => {
    const result = transpile(`
      import { D6, millis } from '@typecad/board-arduino-uno';
      D6.pwm(40);
      const now = millis();
    `, { target: 'arduino' });

    const diagnostics = result.diagnostics.filter(
      d => d.code === 'timer0-pwm-timing-conflict'
    );

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].message).toContain('PD6');
    expect(diagnostics[0].message).toContain('millis()');
  });

  it('does not generate info for non-Timer0 PWM pins with delay()', () => {
    const result = transpile(`
      import { D9, delay } from '@typecad/board-arduino-uno';
      D9.pwm(50);
      delay(10);
    `, { target: 'arduino' });

    const diagnostics = result.diagnostics.filter(
      d => d.code === 'timer0-pwm-timing-conflict'
    );

    expect(diagnostics.length).toBe(0);
  });
});