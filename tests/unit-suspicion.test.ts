import { describe, expect, it } from 'vitest';
import { transpile } from './setup';

describe('Unit Suspicion Validation', () => {
  it('no diagnostics for UART with standard baud rate', () => {
    const result = transpile(`
      import { UART0 } from '@typehal/framework-arduino/arduino';
      UART0.begin(9600);
      UART0.println("hello");
    `, { target: 'arduino' });

    // Unit suspicion validation previously relied on typehal-call IR nodes
    // with structured config builder patterns. In the __EMIT__ system,
    // bus config is lowered to C++ calls and the structured metadata
    // is no longer available for validation.
    const suspicionDiagnostics = result.diagnostics.filter(
      d => d.code === 'suspicious-baud-rate' ||
           d.code === 'suspicious-i2c-speed' ||
           d.code === 'suspicious-spi-frequency'
    );
    expect(suspicionDiagnostics.length).toBe(0);
  });
});
