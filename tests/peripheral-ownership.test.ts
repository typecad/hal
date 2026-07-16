// ---------------------------------------------------------------------------
// Peripheral Ownership Validator Tests
//
// The peripheral ownership validator previously relied on cuttlefish-call IR nodes
// to track take()/release() calls on bus objects. In the __EMIT__ system, these
// calls are lowered to C++ strings and the structured call metadata is no longer
// available. These tests verify that no false ownership diagnostics are generated.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { findDiagnostics, transpile, transpileArduino } from './setup';

describe('Peripheral Ownership Validation', () => {
  it('no diagnostics when ownership pattern is not used', () => {
    const result = transpileArduino(`
      import { SPI0 } from '@typecad/framework-arduino/arduino';
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
      import { SPI0 } from '@typecad/framework-arduino/arduino';
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

  it('flags a double-take on the same bus (hal-ownership-double-take)', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typecad/framework-arduino/arduino';
      I2C0.begin();
      I2C0.take();
      I2C0.take();
    `);

    const doubleTake = result.diagnostics.filter(
      (d) => d.code === 'hal-ownership-double-take'
    );

    expect(doubleTake.length).toBe(1);
    expect(doubleTake[0].severity).toBe('error');
    expect(doubleTake[0].message).toContain('I2C0');
  });

  it('flags a release without a preceding take (hal-ownership-unowned-release)', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typecad/framework-arduino/arduino';
      I2C0.begin();
      I2C0.release();
    `);

    const unownedRelease = result.diagnostics.filter(
      (d) => d.code === 'hal-ownership-unowned-release'
    );

    expect(unownedRelease.length).toBe(1);
    expect(unownedRelease[0].severity).toBe('warning');
    expect(unownedRelease[0].message).toContain('I2C0');
  });
});
