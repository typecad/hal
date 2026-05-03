// ---------------------------------------------------------------------------
// Peripheral Ownership Validator Tests
//
// The peripheral ownership validator previously relied on typehal-call IR nodes
// to track take()/release() calls on bus objects. In the __EMIT__ system, these
// calls are lowered to C++ strings and the structured call metadata is no longer
// available. These tests verify that no false ownership diagnostics are generated.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { findDiagnostics, transpile, transpileArduino } from './setup';

describe('Peripheral Ownership Validation', () => {
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
