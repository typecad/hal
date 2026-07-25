// Pure-function tests for the Arduino Serial debug code generator.
//
// These are the literal strings the preprocessor injects when run with --debug
// against an Arduino target. Asserting them here keeps the emitted serial
// output stable; if these change, the vscode-typecad-debug README's "what you
// see over serial" description and the cuttlefish --debug help text should be
// updated to match.
//
// The generators return string[] (one entry per emitted line). We join with
// '\n' so toContain does substring matching across the indented lines.

import { describe, expect, it } from 'vitest';
import {
  generateSerialInitCode,
  generateBreakpointCode,
  generateLogpointCode,
} from '../../../packages/framework-arduino/src/debug-codegen';

describe('generateSerialInitCode', () => {
  it('emits the DEBUG init markers and Serial.begin(9600)', () => {
    const out = generateSerialInitCode().join('\n');

    expect(out).toContain('// === DEBUG: Initialize Serial ===');
    expect(out).toContain('Serial.begin(9600);');
    expect(out).toContain('while (!Serial) {');
    expect(out).toContain('delay(10);');
    expect(out).toContain('Serial.println("🔧 TypeCAD Debug Mode Active");');
    expect(out).toContain('// === END DEBUG INIT ===');
  });
});

describe('generateBreakpointCode — plain', () => {
  const out = generateBreakpointCode('index.ts', 12, 'let x = compute();', [
    { name: 'x' },
    { name: 'compute', isFunction: true },
  ], undefined).join('\n');

  it('emits the BREAKPOINT marker and header', () => {
    expect(out).toContain('// === BREAKPOINT: index.ts:12 ===');
    expect(out).toContain('Serial.println("⏸️  BREAKPOINT: index.ts:12");');
  });

  it('echoes the original line', () => {
    expect(out).toContain('Serial.println("  let x = compute();");');
  });

  it('dumps non-function variables and labels functions [function]', () => {
    expect(out).toContain('Serial.print("  • x = "); Serial.println(x);');
    expect(out).toContain('Serial.println("  • compute = [function]");');
  });

  it('emits the halt via the continue/skip helper (ENTER/s prompt)', () => {
    expect(out).toContain('Serial.println("  [ENTER: continue | s: skip this breakpoint]");');
    // No breakpointId → halt called with -1 (never disables).
    expect(out).toContain('__tc_debug_wait_for_continue(-1);');
  });

  it('does not wrap in a conditional when none is given', () => {
    expect(out.includes('if (')).toBe(false);
  });
});

describe('generateBreakpointCode — conditional', () => {
  const out = generateBreakpointCode(
    'index.ts', 27, 'counter += 1;', [{ name: 'counter' }], 'counter > 5',
  ).join('\n');

  it('wraps the block in if (condition) { ... }', () => {
    expect(out).toContain('if (counter > 5) {');
    expect(out).toContain('  }');
  });

  it('annotates the header with the condition', () => {
    expect(out).toContain('Serial.println("⏸️  BREAKPOINT: index.ts:27 (condition: counter > 5)");');
  });

  it('indents inner lines with two extra spaces', () => {
    expect(out).toContain('    __tc_debug_wait_for_continue(-1);');
  });
});

describe('generateBreakpointCode — no variables', () => {
  it('prints the "no variables in scope" placeholder', () => {
    const out = generateBreakpointCode('empty.ts', 1, 'noop();', [], undefined).join('\n');
    expect(out).toContain('Serial.println("  (no variables in scope)");');
  });
});

describe('generateBreakpointCode — breakpointId disable guard', () => {
  // When a breakpointId is supplied, the codegen wraps the halt in a per-id
  // disable guard. The disable state lives in the framework shim's registry
  // (keyed by id), so the breakpoint block only emits call expressions — no
  // `static bool` declaration (the transpiler would mangle one in the source).
  it('wraps the halt in if (!__tc_bp_is_disabled(id)) and passes id to the halt', () => {
    const out = generateBreakpointCode('index.ts', 5, 'x++;', [], undefined, 4).join('\n');

    expect(out).toContain('if (!__tc_bp_is_disabled(4)) {');
    expect(out).toContain('__tc_debug_wait_for_continue(4);');
    expect(out).toContain('  }');
    expect(out.includes('static bool __tc_bp_disabled_4')).toBe(false);
  });

  it('without a breakpointId, passes -1 (never disables)', () => {
    const out = generateBreakpointCode('index.ts', 5, 'x++;', [], undefined).join('\n');

    expect(out.includes('__tc_bp_is_disabled')).toBe(false);
    expect(out).toContain('__tc_debug_wait_for_continue(-1);');
  });
});

describe('generateLogpointCode', () => {
  it('emits the LOGPOINT marker and prefix', () => {
    const out = generateLogpointCode('index.ts', 8,
      [{ type: 'text', value: 'reading = ' }, { type: 'variable', value: 'value' }],
      [{ name: 'value' }],
    ).join('\n');

    expect(out).toContain('// === LOGPOINT: index.ts:8 ===');
    expect(out).toContain('Serial.print("[LOG index.ts:8] ");');
    expect(out).toContain('Serial.print("reading = ");');
    expect(out).toContain('Serial.print(value);');
  });

  it('does not emit a halt loop', () => {
    const out = generateLogpointCode('index.ts', 8,
      [{ type: 'text', value: 'hi' }], []).join('\n');
    expect(out.includes('Serial.available()')).toBe(false);
  });

  it('renders an out-of-scope {var} as a literal with a comment', () => {
    const out = generateLogpointCode('index.ts', 8,
      [{ type: 'variable', value: 'missing' }], []).join('\n');
    expect(out).toContain('Serial.print("{missing}"); // variable not in scope');
  });

  it('treats a function-typed variable reference as not-in-scope', () => {
    const out = generateLogpointCode('index.ts', 8,
      [{ type: 'variable', value: 'cb' }], [{ name: 'cb', isFunction: true }]).join('\n');
    expect(out).toContain('Serial.print("{cb}"); // variable not in scope');
  });
});
