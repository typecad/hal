import { describe, it, expect } from 'vitest';
import { transpile } from './setup';

describe('PWM Timer Sharing Validation', () => {
  it('generates info when two PWM pins share the same timer', () => {
    const result = transpile(`
      import { D5, D6 } from '@typehal/board-arduino-uno';
      D5.pwm(25);
      D6.pwm(75);
    `, { target: 'arduino' });

    const diagnostics = result.diagnostics.filter(
      d => d.code === 'pwm-timer-sharing'
    );

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].message).toContain('D5');
    expect(diagnostics[0].message).toContain('D6');
    expect(diagnostics[0].message).toContain('timer0');
    expect(diagnostics[0].severity).toBe('info');
  });

  it('generates info when a PWM alias shares a timer with another PWM pin', () => {
    const result = transpile(`
      import { D3, MOSI } from '@typehal/board-arduino-uno';
      D3.pwm(40);
      MOSI.pwm(60);
    `, { target: 'arduino' });

    const diagnostics = result.diagnostics.filter(
      d => d.code === 'pwm-timer-sharing'
    );

    expect(diagnostics.length).toBeGreaterThan(0);
    // D3 is tracked as PD3 in the board data; MOSI is tracked as MOSI/PB3
    expect(diagnostics[0].message).toContain('PD3');
    expect(diagnostics[0].message).toContain('MOSI');
    expect(diagnostics[0].message).toContain('timer2');
  });

  it('does not generate info when PWM pins use different timers', () => {
    const result = transpile(`
      import { D5, D9 } from '@typehal/board-arduino-uno';
      D5.pwm(25);
      D9.pwm(75);
    `, { target: 'arduino' });

    const diagnostics = result.diagnostics.filter(
      d => d.code === 'pwm-timer-sharing'
    );

    expect(diagnostics.length).toBe(0);
  });
});