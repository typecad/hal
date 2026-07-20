// ---------------------------------------------------------------------------
// Network validation tests
//
// The first test coverage for packages/cuttlefish/src/ir/network-validation.ts.
// Exercises all five existing diagnostics at the unit level by calling
// validateNetworkUsage() directly with a hand-built ProgramIR + fake
// boardConstants Map (the way tests/packages/framework-esp32/diagnostics.test.ts
// does for profileDiagnostics).
//
// Why unit-level and not via transpile(): the transpileAVR() helper does not
// populate the AVR `architecture` board constant, and the validator's
// "no fallbacks" rule means absent board data emits nothing — so the
// wifi-no-radio positive case is only reachable by injecting a fake
// boardConstants Map. The transpiler-path negative case is covered in
// tests/packages/hal/hal-wifi.test.ts.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { validateNetworkUsage } from '../../../packages/cuttlefish/src/ir/network-validation';

/** Build a minimal ProgramIR whose `functions[].statements` carry the given
 *  hal-op statements. Mirrors the fakeProgram() helper in
 *  tests/packages/framework-esp32/diagnostics.test.ts, plus the extra fields
 *  walkProgramIR reads (topLevelStatements / classes / namespaces). */
function fakeProgram(
  statementsByFn: Array<{ name?: string; originalName?: string; statements: any[] }> = [],
): any {
  return {
    fileName: 'test.ts',
    topLevelStatements: [],
    functions: statementsByFn.map((f) => ({
      name: f.name ?? 'setup',
      originalName: f.originalName ?? f.name ?? 'setup',
      statements: f.statements,
      parameters: [],
    })),
    classes: [],
    namespaces: [],
    imports: [],
    typeAliases: [],
  };
}

const halOp = (operation: string, extra: Record<string, any> = {}): any => ({
  kind: 'hal-op',
  operation: { operation, ...extra },
  sourceSpan: { startLine: 1, startColumn: 1, filePath: 'test.ts' },
});

describe('validateNetworkUsage — wifi-no-radio', () => {
  it('errors when wifi.* is used on an AVR board', () => {
    const program = fakeProgram([{ statements: [halOp('wifi.connect', { ssid: '"s"', password: '"p"' })] }]);
    const boardConstants = new Map([['architecture', 'avr']]);
    const diags = validateNetworkUsage(program, boardConstants);
    expect(diags.some(d => d.code === 'wifi-no-radio' && d.severity === 'error')).toBe(true);
  });

  it('errors when http.* is used on an AVR board', () => {
    const program = fakeProgram([{ statements: [halOp('http.send', { blocking: true })] }]);
    const boardConstants = new Map([['architecture', 'avr']]);
    const diags = validateNetworkUsage(program, boardConstants);
    expect(diags.some(d => d.code === 'wifi-no-radio')).toBe(true);
  });

  it('does NOT fire on a WiFi-capable architecture (esp32)', () => {
    const program = fakeProgram([{ statements: [halOp('wifi.connect', { ssid: '"s"', password: '"p"' })] }]);
    const boardConstants = new Map([['architecture', 'esp32']]);
    const diags = validateNetworkUsage(program, boardConstants);
    expect(diags.some(d => d.code === 'wifi-no-radio')).toBe(false);
  });

  it('does NOT fire when board constants are absent (no fallbacks rule)', () => {
    // The validator's documented rule: absent board data emits nothing rather
    // than guessing. This is the regression guard against accidentally
    // introducing an architecture fallback.
    const program = fakeProgram([{ statements: [halOp('wifi.connect', { ssid: '"s"', password: '"p"' })] }]);
    const diags = validateNetworkUsage(program, undefined as any);
    expect(diags.some(d => d.code === 'wifi-no-radio')).toBe(false);
  });

  it('does NOT fire when no wifi./http. ops are present (early return)', () => {
    const program = fakeProgram([{ statements: [halOp('gpio.write', { pin: 2, value: 1 })] }]);
    const boardConstants = new Map([['architecture', 'avr']]);
    const diags = validateNetworkUsage(program, boardConstants);
    expect(diags).toEqual([]);
  });

  it('short-circuits: no other diagnostics pile on after wifi-no-radio', () => {
    // The validator returns early after wifi-no-radio — confirms no piling-on.
    const program = fakeProgram([{
      statements: [
        halOp('wifi.ap_start', { ssid: '"s"', password: '"short"' }), // would be wifi-ap-password-short
        halOp('http.send', { blocking: true }),                       // would be http-without-wifi
      ],
    }]);
    const boardConstants = new Map([['architecture', 'avr']]);
    const diags = validateNetworkUsage(program, boardConstants);
    expect(diags.length).toBe(1);
    expect(diags[0].code).toBe('wifi-no-radio');
  });
});

describe('validateNetworkUsage — http-without-wifi', () => {
  it('warns when http.* is used but no op brings the WiFi link up', () => {
    const program = fakeProgram([{ statements: [halOp('http.send', { blocking: true })] }]);
    const diags = validateNetworkUsage(program, new Map([['architecture', 'esp32']]));
    expect(diags.some(d => d.code === 'http-without-wifi' && d.severity === 'warning')).toBe(true);
  });

  it('does NOT warn when WiFi.connect precedes the HTTP call', () => {
    const program = fakeProgram([{
      statements: [
        halOp('wifi.connect', { ssid: '"s"', password: '"p"' }),
        halOp('http.send', { blocking: true }),
      ],
    }]);
    const diags = validateNetworkUsage(program, new Map([['architecture', 'esp32']]));
    expect(diags.some(d => d.code === 'http-without-wifi')).toBe(false);
  });

  it('does NOT warn when connect_saved brings the link up', () => {
    const program = fakeProgram([{
      statements: [
        halOp('wifi.connect_saved', { timeoutMs: 15000 }),
        halOp('http.send', { blocking: true }),
      ],
    }]);
    const diags = validateNetworkUsage(program, new Map([['architecture', 'esp32']]));
    expect(diags.some(d => d.code === 'http-without-wifi')).toBe(false);
  });

  it('does NOT warn when ap_start brings the link up', () => {
    const program = fakeProgram([{
      statements: [
        halOp('wifi.ap_start', { ssid: '"s"' }),
        halOp('http.send', { blocking: true }),
      ],
    }]);
    const diags = validateNetworkUsage(program, new Map([['architecture', 'esp32']]));
    expect(diags.some(d => d.code === 'http-without-wifi')).toBe(false);
  });
});

describe('validateNetworkUsage — wifi-blocking-in-loop', () => {
  it('warns when WiFi.connect appears directly in loop()', () => {
    const program = fakeProgram([{
      originalName: 'loop',
      statements: [halOp('wifi.connect', { ssid: '"s"', password: '"p"' })],
    }]);
    const diags = validateNetworkUsage(program, new Map([['architecture', 'esp32']]));
    expect(diags.some(d => d.code === 'wifi-blocking-in-loop' && d.severity === 'warning')).toBe(true);
  });

  it('warns when a blocking http.send appears in loop()', () => {
    const program = fakeProgram([{
      originalName: 'loop',
      statements: [halOp('http.send', { blocking: true })],
    }]);
    const diags = validateNetworkUsage(program, new Map([['architecture', 'esp32']]));
    expect(diags.some(d => d.code === 'wifi-blocking-in-loop')).toBe(true);
  });

  it('does NOT warn for the same op in setup()', () => {
    const program = fakeProgram([{
      originalName: 'setup',
      statements: [halOp('wifi.connect', { ssid: '"s"', password: '"p"' })],
    }]);
    const diags = validateNetworkUsage(program, new Map([['architecture', 'esp32']]));
    expect(diags.some(d => d.code === 'wifi-blocking-in-loop')).toBe(false);
  });

  it('does NOT warn when there is no loop() function', () => {
    const program = fakeProgram([{ statements: [halOp('wifi.connect', { ssid: '"s"', password: '"p"' })] }]);
    const diags = validateNetworkUsage(program, new Map([['architecture', 'esp32']]));
    expect(diags.some(d => d.code === 'wifi-blocking-in-loop')).toBe(false);
  });
});

describe('validateNetworkUsage — wifi-ap-password-short', () => {
  it('errors when startAP has a literal password shorter than 8 chars', () => {
    const program = fakeProgram([{ statements: [halOp('wifi.ap_start', { ssid: '"s"', password: '"short"' })] }]);
    const diags = validateNetworkUsage(program, new Map([['architecture', 'esp32']]));
    expect(diags.some(d => d.code === 'wifi-ap-password-short' && d.severity === 'error')).toBe(true);
  });

  it('does NOT error when password is 8+ chars', () => {
    const program = fakeProgram([{ statements: [halOp('wifi.ap_start', { ssid: '"s"', password: '"longpass"' })] }]);
    const diags = validateNetworkUsage(program, new Map([['architecture', 'esp32']]));
    expect(diags.some(d => d.code === 'wifi-ap-password-short')).toBe(false);
  });

  it('does NOT error for an open AP (password omitted)', () => {
    const program = fakeProgram([{ statements: [halOp('wifi.ap_start', { ssid: '"s"' })] }]);
    const diags = validateNetworkUsage(program, new Map([['architecture', 'esp32']]));
    expect(diags.some(d => d.code === 'wifi-ap-password-short')).toBe(false);
  });

  it('does NOT error when password is a non-literal expression', () => {
    // Non-literal values are unknowable at compile time — must not fire.
    const program = fakeProgram([{ statements: [halOp('wifi.ap_start', { ssid: '"s"', password: 'config.pass' })] }]);
    const diags = validateNetworkUsage(program, new Map([['architecture', 'esp32']]));
    expect(diags.some(d => d.code === 'wifi-ap-password-short')).toBe(false);
  });
});

describe('validateNetworkUsage — http-max-body-large', () => {
  it('warns when maxBody exceeds 64 KB', () => {
    const program = fakeProgram([{
      statements: [
        halOp('wifi.connect', { ssid: '"s"', password: '"p"' }),
        halOp('http.set_max_body', { bytes: 100000 }),
      ],
    }]);
    const diags = validateNetworkUsage(program, new Map([['architecture', 'esp32']]));
    expect(diags.some(d => d.code === 'http-max-body-large' && d.severity === 'warning')).toBe(true);
  });

  it('does NOT warn when maxBody is at or below 64 KB', () => {
    const program = fakeProgram([{
      statements: [
        halOp('wifi.connect', { ssid: '"s"', password: '"p"' }),
        halOp('http.set_max_body', { bytes: 65536 }),
      ],
    }]);
    const diags = validateNetworkUsage(program, new Map([['architecture', 'esp32']]));
    expect(diags.some(d => d.code === 'http-max-body-large')).toBe(false);
  });

  it('does NOT warn for the 8 KB default', () => {
    const program = fakeProgram([{
      statements: [
        halOp('wifi.connect', { ssid: '"s"', password: '"p"' }),
        halOp('http.set_max_body', { bytes: 8192 }),
      ],
    }]);
    const diags = validateNetworkUsage(program, new Map([['architecture', 'esp32']]));
    expect(diags.some(d => d.code === 'http-max-body-large')).toBe(false);
  });
});

describe('validateNetworkUsage — diagnostic shape', () => {
  it('stamps source: "network-validation" and position from sourceSpan', () => {
    const program = fakeProgram([{
      statements: [{
        kind: 'hal-op',
        operation: { operation: 'wifi.ap_start', ssid: '"s"', password: '"short"' },
        sourceSpan: { startLine: 42, startColumn: 7, filePath: 'main.ts' },
      }],
    }]);
    const diags = validateNetworkUsage(program, new Map([['architecture', 'esp32']]));
    const d = diags.find(x => x.code === 'wifi-ap-password-short');
    expect(d).toBeDefined();
    expect(d!.source).toBe('network-validation');
    expect(d!.line).toBe(42);
    expect(d!.column).toBe(7);
    expect(d!.filePath).toBe('main.ts');
    expect(d!.message).toMatch(/5 characters/); // password was "short"
    expect(d!.message).toMatch(/at least 8/);
    expect(d!.hint).toBeDefined();
  });
});
