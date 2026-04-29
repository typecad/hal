// ---------------------------------------------------------------------------
// Peripheral Ownership Validator Tests
//
// This suite keeps validator-specific coverage that is intentionally narrower
// than bus-ownership.test.ts. The bus-ownership suite covers user-facing
// feature flow and cross-bus emission; this file focuses on SPI-specific
// diagnostic semantics and message content.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { findDiagnostics, transpile, transpileArduino } from './setup';

describe('Peripheral Ownership Validation', () => {
  it('generates error for double take without release', () => {
    const result = transpile(`
      import { SPI0 } from '@typehal/framework-arduino/arduino';
      SPI0.begin();
      SPI0.take();
      SPI0.take();
    `);

    const errors = findDiagnostics(result, 'peripheral-double-take');
    expect(errors.length).toBe(1);
    expect(errors[0].severity).toBe('error');
    expect(errors[0].message).toContain('already owned');
  });

  it('generates warning for I/O without ownership', () => {
    const result = transpile(`
      import { SPI0 } from '@typehal/framework-arduino/arduino';
      SPI0.begin();
      SPI0.take();
      SPI0.release();
      SPI0.transfer(0xFF);
    `);

    const warnings = findDiagnostics(result, 'peripheral-io-without-ownership');
    expect(warnings.length).toBe(1);
    expect(warnings[0].severity).toBe('warning');
    expect(warnings[0].message).toContain('without ownership');
  });

  it('generates warning for release without take', () => {
    const result = transpile(`
      import { SPI0 } from '@typehal/framework-arduino/arduino';
      SPI0.begin();
      SPI0.release();
    `);

    const warnings = findDiagnostics(result, 'peripheral-release-without-take');
    expect(warnings.length).toBe(1);
    expect(warnings[0].severity).toBe('warning');
    expect(warnings[0].message).toContain('not currently owned');
  });

  it('no diagnostics when ownership pattern is not used', () => {
    const result = transpileArduino(`
      import { SPI0 } from '@typehal/framework-arduino/arduino';
      SPI0.begin();
      SPI0.transfer(0xFF);
    `);

    const ownershipDiagnostics = result.diagnostics.filter(
      (diagnostic) => diagnostic.source === 'peripheral-ownership'
    );
    expect(ownershipDiagnostics.length).toBe(0);
  });

  it('no diagnostics when take/release used correctly', () => {
    const result = transpileArduino(`
      import { SPI0 } from '@typehal/framework-arduino/arduino';
      SPI0.begin();
      SPI0.take();
      SPI0.transfer(0xFF);
      SPI0.release();
    `);

    const ownershipDiagnostics = result.diagnostics.filter(
      (diagnostic) => diagnostic.source === 'peripheral-ownership'
    );
    expect(ownershipDiagnostics.length).toBe(0);
  });
});
