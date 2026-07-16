// ---------------------------------------------------------------------------
// Tests for peripheral pin conflict detection
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpile } from './setup';

describe('Peripheral Pin Conflict Detection', () => {
  it('generates warning when I2C pin is used as GPIO while I2C is active', () => {
    const result = transpile(`
      import { I2C0, A4 } from '@typecad/board-arduino-uno';
      I2C0.begin();
      A4.asOutput();
    `, { target: 'arduino' });

    const conflictWarnings = result.diagnostics.filter(
      d => d.code === 'peripheral-pin-conflict'
    );

    expect(conflictWarnings.length).toBeGreaterThan(0);
    expect(conflictWarnings[0].message).toContain('PC4');
    expect(conflictWarnings[0].message).toContain('I2C0');
    expect(conflictWarnings[0].message).toContain('SDA');
  });

  it('generates warning when I2C SCL pin is used as GPIO', () => {
    const result = transpile(`
      import { I2C0, A5 } from '@typecad/board-arduino-uno';
      I2C0.begin();
      A5.asOutput();
    `, { target: 'arduino' });

    const conflictWarnings = result.diagnostics.filter(
      d => d.code === 'peripheral-pin-conflict'
    );

    expect(conflictWarnings.length).toBeGreaterThan(0);
    expect(conflictWarnings[0].message).toContain('PC5');
    expect(conflictWarnings[0].message).toContain('SCL');
  });

  it('generates warning when I2C alias SDA is used as GPIO while I2C is active', () => {
    const result = transpile(`
      import { I2C0, SDA } from '@typecad/board-arduino-uno';
      I2C0.begin();
      SDA.asOutput();
    `, { target: 'arduino' });

    const conflictWarnings = result.diagnostics.filter(
      d => d.code === 'peripheral-pin-conflict'
    );

    expect(conflictWarnings.length).toBeGreaterThan(0);
    expect(conflictWarnings[0].message).toContain('PC4');
    expect(conflictWarnings[0].message).toContain('I2C0');
  });

  it('does not generate warning when I2C pin is used without I2C active', () => {
    const result = transpile(`
      import { A4 } from '@typecad/board-arduino-uno';
      A4.asOutput();
    `, { target: 'arduino' });

    const conflictWarnings = result.diagnostics.filter(
      d => d.code === 'peripheral-pin-conflict'
    );

    expect(conflictWarnings.length).toBe(0);
  });

  it('generates warning when SPI pin is used as GPIO while SPI is active', () => {
    const result = transpile(`
      import { SPI0, D11 } from '@typecad/board-arduino-uno';
      SPI0.begin();
      D11.asOutput();
    `, { target: 'arduino' });

    const conflictWarnings = result.diagnostics.filter(
      d => d.code === 'peripheral-pin-conflict'
    );

    expect(conflictWarnings.length).toBeGreaterThan(0);
    expect(conflictWarnings[0].message).toContain('PB3');
    expect(conflictWarnings[0].message).toContain('SPI0');
    expect(conflictWarnings[0].message).toContain('MOSI');
  });

  it('generates warning when UART TX pin is used as GPIO', () => {
    const result = transpile(`
      import { Serial, D1 } from '@typecad/board-arduino-uno';
      Serial.begin(9600);
      D1.asOutput();
    `, { target: 'arduino' });

    const conflictWarnings = result.diagnostics.filter(
      d => d.code === 'peripheral-pin-conflict'
    );

    expect(conflictWarnings.length).toBeGreaterThan(0);
    expect(conflictWarnings[0].message).toContain('PD1');
    expect(conflictWarnings[0].message).toContain('TX');
  });
});
