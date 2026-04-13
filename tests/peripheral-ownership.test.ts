// ---------------------------------------------------------------------------
// Peripheral Ownership Validation Tests
//
// Tests for the take()/release() bus ownership pattern:
//   - C++ emission for take/release on Arduino (comment no-ops)
//   - Diagnostic: double-take error
//   - Diagnostic: I/O without ownership warning
//   - Diagnostic: release without take warning
//   - No diagnostics when ownership pattern is not used (opt-in)
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpile } from './setup';

describe('Peripheral Ownership Validation', () => {
  it('emits comment for SPI0.take() on Arduino', () => {
    const result = transpile(`
      import { SPI0 } from '@typecode/board-arduino-uno/arduino';
      SPI0.begin();
      SPI0.take();
      SPI0.transfer(0xFF);
      SPI0.release();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('/* SPI0.take() */');
    expect(result.cpp).toContain('/* SPI0.release() */');
  });

  it('emits comment for I2C0.take() on Arduino', () => {
    const result = transpile(`
      import { I2C0 } from '@typecode/board-arduino-uno/arduino';
      I2C0.begin();
      I2C0.take();
      I2C0.release();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('/* I2C0.take() */');
    expect(result.cpp).toContain('/* I2C0.release() */');
  });

  it('emits comment for UART0.take() on Arduino', () => {
    const result = transpile(`
      import { UART0 } from '@typecode/board-arduino-uno/arduino';
      const uart = UART0.begin(9600);
      UART0.take();
      UART0.release();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('/* UART0.take() */');
    expect(result.cpp).toContain('/* UART0.release() */');
  });

  it('generates error for double take without release', () => {
    const result = transpile(`
      import { SPI0 } from '@typecode/board-arduino-uno/arduino';
      SPI0.begin();
      SPI0.take();
      SPI0.take();
    `);

    const errors = result.diagnostics.filter(
      d => d.code === 'peripheral-double-take'
    );
    expect(errors.length).toBe(1);
    expect(errors[0].severity).toBe('error');
    expect(errors[0].message).toContain('already owned');
  });

  it('generates warning for I/O without ownership', () => {
    const result = transpile(`
      import { SPI0 } from '@typecode/board-arduino-uno/arduino';
      SPI0.begin();
      SPI0.take();
      SPI0.release();
      SPI0.transfer(0xFF);
    `);

    const warnings = result.diagnostics.filter(
      d => d.code === 'peripheral-io-without-ownership'
    );
    expect(warnings.length).toBe(1);
    expect(warnings[0].severity).toBe('warning');
    expect(warnings[0].message).toContain('without ownership');
  });

  it('generates warning for release without take', () => {
    const result = transpile(`
      import { SPI0 } from '@typecode/board-arduino-uno/arduino';
      SPI0.begin();
      SPI0.release();
    `);

    const warnings = result.diagnostics.filter(
      d => d.code === 'peripheral-release-without-take'
    );
    expect(warnings.length).toBe(1);
    expect(warnings[0].severity).toBe('warning');
    expect(warnings[0].message).toContain('not currently owned');
  });

  it('no diagnostics when ownership pattern is not used', () => {
    const result = transpile(`
      import { SPI0 } from '@typecode/board-arduino-uno/arduino';
      SPI0.begin();
      SPI0.transfer(0xFF);
    `);

    const ownershipDiagnostics = result.diagnostics.filter(
      d => d.source === 'peripheral-ownership'
    );
    expect(ownershipDiagnostics.length).toBe(0);
  });

  it('no diagnostics when take/release used correctly', () => {
    const result = transpile(`
      import { SPI0 } from '@typecode/board-arduino-uno/arduino';
      SPI0.begin();
      SPI0.take();
      SPI0.transfer(0xFF);
      SPI0.release();
    `);

    const ownershipDiagnostics = result.diagnostics.filter(
      d => d.source === 'peripheral-ownership'
    );
    expect(ownershipDiagnostics.length).toBe(0);
  });
});
