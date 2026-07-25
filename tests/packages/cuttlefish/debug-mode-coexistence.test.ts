// Regression guard for the gdb/printf coexistence contract: when the active
// strategy's debugMode is 'gdb' for the current target, the printf
// preprocessor must NOT run, even if breakpoints are loaded. The gdb path
// uses VS Code native breakpoints + #line markers instead.
//
// This test pins the capability decision that the branch in transpile.ts
// depends on. The end-to-end "transpile with debug+s3 produces no
// __tc_debug_wait_for_continue" assertion lives in the demo regeneration
// (Task 9) since it requires a full ESP-IDF toolchain in scope.

import { describe, it, expect } from 'vitest';
import { Esp32Strategy } from '../../../packages/framework-esp32/src/strategy';
import { GenericStrategy } from '../../../packages/cuttlefish/src/platform/generic-strategy';

describe('debug printf/gdb coexistence', () => {
  it('esp32s3 selects gdb mode (skips printf preprocessor)', () => {
    const s = new Esp32Strategy();
    expect(s.debugMode('esp32s3')).toBe('gdb');
  });

  it('non-gdb targets keep printf mode', () => {
    const s = new Esp32Strategy();
    expect(s.debugMode('esp32')).toBe('printf');
    expect(new GenericStrategy().debugMode('esp32s3')).toBe('printf');
  });
});
