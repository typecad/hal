// Pure-function tests for the ESP32 native ESP-IDF debug code generator.
//
// These are the literal strings Esp32Strategy's generateDebug* overrides emit
// when run with `cuttlefish build --debug` against an ESP-IDF target. They
// mirror the Arduino debug-codegen tests but assert the ESP-IDF idiom
// (printf/getchar via __tc_debug_wait_for_enter) instead of Serial.* — which
// does not compile under native ESP-IDF (Esp32Strategy strips <HardwareSerial.h>).
//
// The generators return string[]; we join with '\n' so toContain does substring
// matching across indented lines.

import { describe, expect, it } from 'vitest';
import {
  generateEspIdfInitCode,
  generateEspIdfBreakpointCode,
  generateEspIdfLogpointCode,
} from '../../../packages/framework-esp32/src/debug-codegen';

describe('generateEspIdfInitCode', () => {
  it('emits a banner printf and no Serial.begin', () => {
    const out = generateEspIdfInitCode().join('\n');

    expect(out).toContain('// === DEBUG: ESP-IDF console ===');
    expect(out).toContain('printf("🔧 TypeCAD Debug Mode Active\\n");');
    expect(out).toContain('// === END DEBUG INIT ===');
    // ESP-IDF's console is auto-initialized by app startup — no begin needed.
    expect(out.includes('Serial.begin')).toBe(false);
    expect(out.includes('while (!Serial)')).toBe(false);
  });
});

describe('generateEspIdfBreakpointCode — plain', () => {
  const out = generateEspIdfBreakpointCode('index.ts', 12, 'let x = compute();', [
    { name: 'x' },
    { name: 'compute', isFunction: true },
  ], undefined).join('\n');

  it('emits the BREAKPOINT marker and header via printf', () => {
    expect(out).toContain('// === BREAKPOINT: index.ts:12 ===');
    expect(out).toContain('printf("⏸️  BREAKPOINT: index.ts:12\\n");');
  });

  it('echoes the original line', () => {
    expect(out).toContain('printf("  let x = compute();\\n");');
  });

  it('dumps non-function variables (unknown type → (double) cast + %g) and labels functions [function]', () => {
    expect(out).toContain('printf("  • x = %g\\n", (double)(x));');
    expect(out).toContain('printf("  • compute = [function]\\n");');
  });

  it('halts via the watchdog-fed getchar helper', () => {
    expect(out).toContain('printf("  [ENTER: continue | s: skip this breakpoint]\\n");');
    // No breakpointId passed → halt called with -1 (never disables).
    expect(out).toContain('__tc_debug_wait_for_continue(-1);');
  });

  it('never emits Arduino Serial.* idioms', () => {
    expect(out.includes('Serial.println')).toBe(false);
    expect(out.includes('Serial.available')).toBe(false);
    expect(out.includes('Serial.read')).toBe(false);
  });

  it('does not wrap in a conditional when none is given', () => {
    expect(out.includes('if (')).toBe(false);
  });
});

describe('generateEspIdfBreakpointCode — conditional', () => {
  const out = generateEspIdfBreakpointCode(
    'index.ts', 27, 'counter += 1;', [{ name: 'counter' }], 'counter > 5',
  ).join('\n');

  it('wraps the block in if (condition) { ... }', () => {
    expect(out).toContain('if (counter > 5) {');
    expect(out).toContain('  }');
  });

  it('annotates the header with the condition', () => {
    expect(out).toContain('printf("⏸️  BREAKPOINT: index.ts:27 (condition: counter > 5)\\n");');
  });

  it('indents inner lines with two extra spaces', () => {
    expect(out).toContain('    __tc_debug_wait_for_continue(-1);');
  });
});

describe('generateEspIdfBreakpointCode — no variables', () => {
  it('prints the "no variables in scope" placeholder', () => {
    const out = generateEspIdfBreakpointCode('empty.ts', 1, 'noop();', [], undefined).join('\n');
    expect(out).toContain('printf("  (no variables in scope)\\n");');
  });
});

describe('generateEspIdfBreakpointCode — breakpointId disable guard', () => {
  // When a breakpointId is supplied, the codegen wraps the halt in a per-id
  // disable guard so the 's' key can skip this one breakpoint for the run. The
  // disable state lives in the framework shim's registry (keyed by id), so the
  // breakpoint block only emits call expressions — no `static bool` declaration
  // (the transpiler would mangle one injected into the source).
  it('wraps the halt in if (!__tc_bp_is_disabled(id)) and passes id to the halt', () => {
    const out = generateEspIdfBreakpointCode('index.ts', 5, 'x++;', [], undefined, 7).join('\n');

    expect(out).toContain('if (!__tc_bp_is_disabled(7)) {');
    // The halt call passes the id so 's' can record it in the registry.
    expect(out).toContain('__tc_debug_wait_for_continue(7);');
    expect(out).toContain('  }');
    // No per-breakpoint static declaration in the parsed source.
    expect(out.includes('static bool __tc_bp_disabled_7')).toBe(false);
  });

  it('composes the disable guard with a condition (guard is outermost)', () => {
    const out = generateEspIdfBreakpointCode('index.ts', 5, 'x++;', [], 'x > 0', 3).join('\n');

    // Disable guard wraps the condition: skip = no condition eval either.
    const guardIdx = out.indexOf('if (!__tc_bp_is_disabled(3))');
    const condIdx = out.indexOf('if (x > 0)');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(condIdx).toBeGreaterThan(guardIdx);
    // Closing braces: one for the condition, one for the guard.
    expect(out.match(/  }\n/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('without a breakpointId, passes -1 (never disables)', () => {
    const out = generateEspIdfBreakpointCode('index.ts', 5, 'x++;', [], undefined).join('\n');

    expect(out.includes('__tc_bp_is_disabled')).toBe(false);
    expect(out).toContain('__tc_debug_wait_for_continue(-1);');
  });
});

describe('generateEspIdfBreakpointCode — format specifier per cppType', () => {
  // The debug preprocessor has no TypeChecker, so cppType is a coarse category
  // inferred from annotation/initializer shape. These cover each branch of
  // formatSpecFor so printf never trips -Werror=format=.
  const cases: Array<{ name: string; cppType: 'bool'|'int'|'long'|'float'|'string'|'unknown'; expect: string }> = [
    { name: 'flag', cppType: 'bool', expect: 'printf("  • flag = %d\\n", flag);' },
    { name: 'count', cppType: 'int', expect: 'printf("  • count = %d\\n", count);' },
    { name: 'uptime', cppType: 'long', expect: 'printf("  • uptime = %ld\\n", uptime);' },
    { name: 'temp', cppType: 'float', expect: 'printf("  • temp = %g\\n", temp);' },
    { name: 'msg', cppType: 'string', expect: 'printf("  • msg = %s\\n", msg);' },
    { name: 'opaque', cppType: 'unknown', expect: 'printf("  • opaque = %g\\n", (double)(opaque));' },
    // No cppType at all (e.g. a bare { name } from an older caller) → unknown.
    { name: 'bare', cppType: undefined as never, expect: 'printf("  • bare = %g\\n", (double)(bare));' },
  ];

  for (const c of cases) {
    it(`uses the right specifier for cppType=${c.cppType}`, () => {
      const out = generateEspIdfBreakpointCode('t.ts', 1, 'x;', [{ name: c.name, cppType: c.cppType }], undefined).join('\n');
      expect(out).toContain(c.expect);
    });
  }
});

describe('generateEspIdfLogpointCode', () => {
  it('emits the LOGPOINT marker and prefix via printf', () => {
    const out = generateEspIdfLogpointCode('index.ts', 8,
      [{ type: 'text', value: 'reading = ' }, { type: 'variable', value: 'value' }],
      [{ name: 'value' }],
    ).join('\n');

    expect(out).toContain('// === LOGPOINT: index.ts:8 ===');
    expect(out).toContain('printf("[LOG index.ts:8] ");');
    expect(out).toContain('printf("reading = ");');
    expect(out).toContain('printf("%g", (double)(value));');
  });

  it('does not halt (logpoints never block)', () => {
    const out = generateEspIdfLogpointCode('index.ts', 8,
      [{ type: 'text', value: 'hi' }], []).join('\n');
    expect(out.includes('__tc_debug_wait_for_enter')).toBe(false);
  });

  it('renders an out-of-scope {var} as a literal with a comment', () => {
    const out = generateEspIdfLogpointCode('index.ts', 8,
      [{ type: 'variable', value: 'missing' }], []).join('\n');
    expect(out).toContain('printf("{missing}"); // variable not in scope');
  });

  it('treats a function-typed variable reference as not-in-scope', () => {
    const out = generateEspIdfLogpointCode('index.ts', 8,
      [{ type: 'variable', value: 'cb' }], [{ name: 'cb', isFunction: true }]).join('\n');
    expect(out).toContain('printf("{cb}"); // variable not in scope');
  });

  it('escapes special characters in text parts', () => {
    const out = generateEspIdfLogpointCode('index.ts', 8,
      [{ type: 'text', value: 'say "hi"\n' }], []).join('\n');
    expect(out).toContain('printf("say \\"hi\\"\\n");');
  });
});
