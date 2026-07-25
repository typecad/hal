// Unit tests for the platform-conditional debugMode capability.
//
// debugMode(target) decides whether `--debug` takes the GDB path ('gdb',
// emitted #line directives + debug config artifacts) or the legacy printf
// instrumentation path ('printf'). GenericStrategy defaults to printf;
// Esp32Strategy returns gdb only for esp32s3.

import { describe, it, expect } from 'vitest';
import { Esp32Strategy } from '../../../packages/framework-esp32/src/strategy';
import { GenericStrategy } from '../../../packages/cuttlefish/src/platform/generic-strategy';

describe('debugMode capability', () => {
  it('GenericStrategy defaults to printf', () => {
    const s = new GenericStrategy();
    expect(s.debugMode()).toBe('printf');
    expect(s.debugMode('esp32s3')).toBe('printf');
  });

  it('Esp32Strategy returns gdb for esp32s3', () => {
    const s = new Esp32Strategy();
    expect(s.debugMode('esp32s3')).toBe('gdb');
  });

  it('Esp32Strategy returns printf for unsupported variants', () => {
    const s = new Esp32Strategy();
    expect(s.debugMode('esp32')).toBe('printf');
    expect(s.debugMode('esp32c3')).toBe('printf');
    expect(s.debugMode(undefined)).toBe('printf');
  });
});
