// Tests for the debug preprocessor — the consumer half of the
// vscode-typecad-debug ↔ cuttlefish bridge.
//
// preprocess() reads a TypeScript source string + a BreakpointMap and injects
// the framework's debug code. The global vitest setup (tests/setup-framework.ts)
// registers ArduinoStrategy as the default framework, so these tests assert on
// the Arduino Serial output strings emitted by framework-arduino's
// debug-codegen: the `// === DEBUG: Initialize Serial ===` init block, the
// `⏸️  BREAKPOINT:` header, the `while(Serial.available()...)` halt loop, etc.

import { describe, expect, it } from 'vitest';
import { preprocess } from '../../../packages/cuttlefish/src/debug/preprocessor';
import type { BreakpointMap } from '../../../packages/cuttlefish/src/debug/types';

const SRC = `let counter = 0;
counter = counter + 1;
const label = "hello";
let compute = () => 1;
counter = counter + 2;
`;

describe('preprocess — insertion behavior', () => {
  it('injects the Serial init block before the first non-import line', () => {
    const breakpoints: BreakpointMap = { 'sample.ts': [{ file: 'sample.ts', line: 2 }] };
    const out = preprocess({ fileName: 'sample.ts', breakpoints, source: SRC });

    expect(out).toContain('Serial.begin(9600);');
    expect(out).toContain('🔧 TypeCAD Debug Mode Active');
  });

  it('injects the breakpoint block before the breakpoint line and preserves the original line', () => {
    const breakpoints: BreakpointMap = { 'sample.ts': [{ file: 'sample.ts', line: 2 }] };
    const out = preprocess({ fileName: 'sample.ts', breakpoints, source: SRC });

    const lines = out.split('\n');
    // Find the injected BREAKPOINT marker and the original line it precedes.
    const markerIdx = lines.findIndex(l => l.includes('// === BREAKPOINT: sample.ts:2 ==='));
    expect(markerIdx).toBeGreaterThan(-1);
    // The original line `counter = counter + 1;` must still appear AFTER the marker.
    const origIdx = lines.findIndex((l, i) => i > markerIdx && l.trim() === 'counter = counter + 1;');
    expect(origIdx).toBeGreaterThan(markerIdx);
  });

  it('returns source unchanged when there are no breakpoints for the file', () => {
    const breakpoints: BreakpointMap = { 'other.ts': [{ file: 'other.ts', line: 1 }] };

    expect(preprocess({ fileName: 'sample.ts', breakpoints, source: SRC })).toBe(SRC);
  });
});

describe('preprocess — breakpoint kinds', () => {
  it('wraps a conditional breakpoint in if (...) { ... }', () => {
    const breakpoints: BreakpointMap = {
      'sample.ts': [{ file: 'sample.ts', line: 2, condition: 'counter === 5' }],
    };
    const out = preprocess({ fileName: 'sample.ts', breakpoints, source: SRC });

    // === normalized === -> ==, and wrapped in if.
    expect(out).toContain('if (counter == 5) {');
    expect(out).toContain('}'); // closing brace present
    expect(out).not.toContain('=== 5');
  });

  it('emits a logpoint (no halt loop) when logMessage is set', () => {
    const breakpoints: BreakpointMap = {
      'sample.ts': [{ file: 'sample.ts', line: 3, logMessage: 'label is {label}' }],
    };
    const out = preprocess({ fileName: 'sample.ts', breakpoints, source: SRC });

    expect(out).toContain('// === LOGPOINT: sample.ts:3 ===');
    // Logpoints interpolate in-scope variables and never block.
    expect(out).toContain('Serial.print(label);');
    // The blocking halt loop belongs only to plain breakpoints.
    expect(out).not.toContain('while(Serial.available() == 0)');
  });

  it('renders an out-of-scope {var} as a literal in a logpoint', () => {
    const breakpoints: BreakpointMap = {
      'sample.ts': [{ file: 'sample.ts', line: 1, logMessage: '{missing}' }],
    };
    const out = preprocess({ fileName: 'sample.ts', breakpoints, source: SRC });

    expect(out).toContain('Serial.print("{missing}"); // variable not in scope');
  });
});

describe('preprocess — scope analysis', () => {
  it('captures in-scope module variables and renders functions as [function]', () => {
    // Line 2 is at module scope: counter, label, compute, and the breakpoint's
    // own neighbors are visible. `compute` is a function-valued initializer.
    const breakpoints: BreakpointMap = { 'sample.ts': [{ file: 'sample.ts', line: 2 }] };
    const out = preprocess({ fileName: 'sample.ts', breakpoints, source: SRC });

    expect(out).toContain('Serial.print("  • counter = "); Serial.println(counter);');
    expect(out).toContain('Serial.println("  • compute = [function]");');
  });

  it('captures locals and parameters inside a function', () => {
    const fnSrc = `let total = 0;
function add(a: number): number {
  const step = 1;
  return a + step;
}
`;
    // Breakpoint on `return a + step;` (line 4).
    const breakpoints: BreakpointMap = { 'fn.ts': [{ file: 'fn.ts', line: 4 }] };
    const out = preprocess({ fileName: 'fn.ts', breakpoints, source: fnSrc });

    // `a`, `step`, and module-level `total` should all be captured.
    expect(out).toContain('Serial.println(a);');
    expect(out).toContain('Serial.println(step);');
    expect(out).toContain('Serial.println(total);');
  });
});

describe('preprocess — scope filtering (use-before-declaration)', () => {
  // The breakpoint dump is injected at the START of the breakpoint line, before
  // that line's own declaration runs. So a body local is only in scope on lines
  // STRICTLY after its declaration line. This prevents both the compile error
  // (use-before-declaration on the declaring line) and runtime reads of
  // uninitialized locals. See ScopeAnalyzer.recordFunction.
  it('does NOT dump a local on its own declaring line', () => {
    const fnSrc = `let outer = 0;
function f() {
  const freshly = millis();
  const later = 1;
}
`;
    // Breakpoint on `const freshly = millis();` (line 3).
    const breakpoints: BreakpointMap = { 'f.ts': [{ file: 'f.ts', line: 3 }] };
    const out = preprocess({ fileName: 'f.ts', breakpoints, source: fnSrc });

    // `freshly` is declared on the breakpoint line itself → not yet in scope.
    // (It will still appear in the echoed original line / marker header, so we
    // assert against the variable-dump form specifically.)
    expect(out.includes('Serial.println(freshly);')).toBe(false);
    // But module-scope `outer` IS in scope.
    expect(out).toContain('Serial.println(outer);');
  });

  it('excludes a local not yet declared at an earlier breakpoint', () => {
    const fnSrc = `function f() {
  const first = 1;
  const second = 2;
  const third = 3;
}
`;
    // Breakpoint on `const first = 1;` (line 2): second/third are declared later.
    const breakpoints: BreakpointMap = { 'f.ts': [{ file: 'f.ts', line: 2 }] };
    const out = preprocess({ fileName: 'f.ts', breakpoints, source: fnSrc });

    expect(out).not.toContain('Serial.println(second);');
    expect(out).not.toContain('Serial.println(third);');
  });

  it('includes earlier-declared locals but not later ones', () => {
    const fnSrc = `function f() {
  const first = 1;
  const second = 2;
  const third = 3;
}
`;
    // Breakpoint on `const third = 3;` (line 4): first & second are in scope, third is not.
    const breakpoints: BreakpointMap = { 'f.ts': [{ file: 'f.ts', line: 4 }] };
    const out = preprocess({ fileName: 'f.ts', breakpoints, source: fnSrc });

    expect(out).toContain('Serial.println(first);');
    expect(out).toContain('Serial.println(second);');
    expect(out).not.toContain('Serial.println(third);');
  });

  it('always includes params and module-scope vars from the first function line', () => {
    const fnSrc = `let global = 0;
function f(a: number) {
  const only = 1;
}
`;
    // Breakpoint on the function's first body line (line 3): param a + global present.
    const breakpoints: BreakpointMap = { 'f.ts': [{ file: 'f.ts', line: 3 }] };
    const out = preprocess({ fileName: 'f.ts', breakpoints, source: fnSrc });

    expect(out).toContain('Serial.println(a);');
    expect(out).toContain('Serial.println(global);');
  });
});

describe('preprocess — file matching', () => {
  it('matches breakpoints keyed by basename against an absolute path fileName', () => {
    // Extension writes basenames; the transpiler passes absolute paths.
    const breakpoints: BreakpointMap = { 'matchme.ts': [{ file: 'matchme.ts', line: 1 }] };
    const out = preprocess({
      fileName: '/home/user/proj/src/matchme.ts',
      breakpoints,
      source: SRC,
    });

    expect(out).toContain('// === BREAKPOINT: matchme.ts:1 ===');
  });
});
