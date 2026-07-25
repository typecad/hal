// End-to-end dispatch test: verifies that when Esp32Strategy is the loaded
// framework, the cuttlefish debug preprocessor routes through Esp32Strategy's
// generateDebug* overrides (native ESP-IDF output) instead of the inherited
// Arduino Serial.println codegen.
//
// The global vitest setup (tests/setup-framework.ts) loads ArduinoStrategy by
// default. These tests swap in Esp32Strategy for the duration of each test and
// restore the Arduino default in afterEach so other test files are unaffected.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { preprocess } from '../../../packages/cuttlefish/src/debug/preprocessor';
import {
  getLoadedFramework,
  setLoadedFramework,
  clearLoadedFramework,
} from '../../../packages/cuttlefish/src/framework-registry';
import { Esp32Strategy } from '../../../packages/framework-esp32/src/strategy';
import type { LoadedFramework } from '../../../packages/cuttlefish/src/framework-registry';
import type { BreakpointMap } from '../../../packages/cuttlefish/src/debug/types';

const SRC = `let counter = 0;
counter = counter + 1;
const label = "hello";
counter = counter + 2;
`;

describe('Esp32Strategy debug dispatch', () => {
  let saved: LoadedFramework | undefined;

  beforeEach(() => {
    // Preserve whatever the global setup installed (ArduinoStrategy) so we
    // can restore it exactly.
    saved = getLoadedFramework();
    const esp32 = new Esp32Strategy();
    setLoadedFramework({ strategy: esp32 } as LoadedFramework);
  });

  afterEach(() => {
    // Restore the pre-test framework. The global setup's ArduinoStrategy is
    // the normal state for the rest of the suite.
    if (saved) {
      setLoadedFramework(saved);
    } else {
      clearLoadedFramework();
    }
  });

  it('emits the ESP-IDF debug init banner (printf), not Serial.begin', () => {
    const breakpoints: BreakpointMap = { 'sample.ts': [{ file: 'sample.ts', line: 2 }] };
    const out = preprocess({ fileName: 'sample.ts', breakpoints, source: SRC });

    expect(out).toContain('printf("🔧 TypeCAD Debug Mode Active\\n");');
    expect(out).toContain('// === DEBUG: ESP-IDF console ===');
    expect(out.includes('Serial.begin')).toBe(false);
  });

  it('emits a breakpoint via printf with a per-id disable guard and the s/ENTER halt', () => {
    const breakpoints: BreakpointMap = { 'sample.ts': [{ file: 'sample.ts', line: 2 }] };
    const out = preprocess({ fileName: 'sample.ts', breakpoints, source: SRC });

    expect(out).toContain('// === BREAKPOINT: sample.ts:2 ===');
    expect(out).toContain('printf("⏸️  BREAKPOINT: sample.ts:2\\n");');
    // The preprocessor assigns a per-file breakpoint ID (0 here) → the codegen
    // wraps the halt in if(!__tc_bp_is_disabled(0)) and passes 0 to the helper.
    // (The disable registry itself lives in the framework shim, not here.)
    expect(out).toContain('if (!__tc_bp_is_disabled(0)) {');
    expect(out).toContain('__tc_debug_wait_for_continue(0);');
    // Prompt mentions both keys.
    expect(out).toContain('printf("  [ENTER: continue | s: skip this breakpoint]\\n");');
  });

  it('does not emit any Arduino Serial.* debug code', () => {
    const breakpoints: BreakpointMap = { 'sample.ts': [{ file: 'sample.ts', line: 2 }] };
    const out = preprocess({ fileName: 'sample.ts', breakpoints, source: SRC });

    // None of the inherited-Arduino idioms should appear.
    expect(out.includes('Serial.println')).toBe(false);
    expect(out.includes('Serial.print')).toBe(false);
    expect(out.includes('Serial.available')).toBe(false);
    expect(out.includes('Serial.begin')).toBe(false);
  });

  it('captures in-scope variables and renders them with the inferred specifier (int → %d)', () => {
    const breakpoints: BreakpointMap = { 'sample.ts': [{ file: 'sample.ts', line: 4 }] };
    const out = preprocess({ fileName: 'sample.ts', breakpoints, source: SRC });

    // counter is declared `let counter = 0` → inferred int → %d (not %g).
    expect(out).toContain('printf("  • counter = %d\\n", counter);');
  });

  it('emits a logpoint (no halt) when logMessage is set', () => {
    const breakpoints: BreakpointMap = {
      'sample.ts': [{ file: 'sample.ts', line: 3, logMessage: 'label is {label}' }],
    };
    const out = preprocess({ fileName: 'sample.ts', breakpoints, source: SRC });

    expect(out).toContain('// === LOGPOINT: sample.ts:3 ===');
    expect(out).toContain('printf("[LOG sample.ts:3] ");');
    // label is declared `const label = "hello"` → inferred string → %s.
    expect(out).toContain('printf("%s", label);');
    expect(out.includes('__tc_debug_wait_for_enter')).toBe(false);
  });
});
