import { describe, it, expect } from 'vitest';
import {
  lowerPreferences,
  preferencesInitLines,
} from '../../../../packages/framework-zephyr/src/lowering/preferences';

describe('preferences init block', () => {
  it('emits CUTTLEFISH_PREFS markers + the settings handler + cache', () => {
    const lines = preferencesInitLines().join('\n');
    expect(lines).toContain('// CUTTLEFISH_PREFS_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_PREFS_END');
    // The compile-time settings handler owns the "tc" tree.
    expect(lines).toContain('SETTINGS_STATIC_HANDLER_DEFINE(tc_prefs, "tc"');
    // The cache struct + slot pool are present.
    expect(lines).toContain('struct __tc_prefs_slot final');
    expect(lines).toContain('__tc_prefs_slot slots[__TC_PREFS_SLOT_COUNT]');
    // The one-time load guard.
    expect(lines).toContain('settings_subsys_init()');
    expect(lines).toContain('settings_load()');
    // settings_save_one backs every put_*; settings_delete backs remove/clear.
    expect(lines).toContain('settings_save_one');
    expect(lines).toContain('settings_delete');
  });

  it('uses AUTOSAR-compliant casts (no C-style casts)', () => {
    const lines = preferencesInitLines().join('\n');
    expect(lines).toContain('static_cast');
    // A C-style cast like `(int)x` would show as `)(`; assert none of the
    // suspicious patterns appear. (memcpy-style `(void)expr` casts to void are
    // idiomatic and allowed — they are not numeric reinterpretations.)
    expect(lines).not.toMatch(/\b\w+\s*\*\s*\)\s*\w/); // no `(type*)x`
  });
});

describe('preferences lowering — lifecycle', () => {
  it('clear → __tc_prefs_clear with the namespace prefix', () => {
    expect(lowerPreferences({ operation: 'preferences.clear', ns: 'app' } as any))
      .toEqual({ code: '__tc_prefs_clear("tc/app/");' });
  });

  it('remove → full settings name composed at emit time', () => {
    expect(lowerPreferences({ operation: 'preferences.remove', ns: 'app', key: '"k"' } as any))
      .toEqual({ code: '__tc_prefs_remove("tc/app/k");' });
  });
});

describe('preferences lowering — typed put (statements)', () => {
  it('put_int / put_float pass value through', () => {
    expect(lowerPreferences({ operation: 'preferences.put_int', ns: 'app', key: '"count"', value: 42 } as any))
      .toEqual({ code: '__tc_prefs_put_int("tc/app/count", 42);' });
    expect(lowerPreferences({ operation: 'preferences.put_float', ns: 'app', key: '"gain"', value: 2.5 } as any))
      .toEqual({ code: '__tc_prefs_put_float("tc/app/gain", 2.5);' });
  });

  it('put_bool renders the C++ bool literal', () => {
    expect(lowerPreferences({ operation: 'preferences.put_bool', ns: 'app', key: '"flag"', value: true } as any))
      .toEqual({ code: '__tc_prefs_put_bool("tc/app/flag", true);' });
    expect(lowerPreferences({ operation: 'preferences.put_bool', ns: 'app', key: '"flag"', value: false } as any))
      .toEqual({ code: '__tc_prefs_put_bool("tc/app/flag", false);' });
  });

  it('put_string passes key + value', () => {
    expect(lowerPreferences({ operation: 'preferences.put_string', ns: 'app', key: '"label"', value: '"hello"' } as any))
      .toEqual({ code: '__tc_prefs_put_string("tc/app/label", "hello");' });
  });
});

describe('preferences lowering — typed get (expressions)', () => {
  it('get_int / get_float return the default on the expression path', () => {
    expect(lowerPreferences({ operation: 'preferences.get_int', ns: 'app', key: '"count"', defaultValue: 0 } as any))
      .toEqual({ expression: '__tc_prefs_get_int("tc/app/count", 0)' });
    expect(lowerPreferences({ operation: 'preferences.get_float', ns: 'app', key: '"gain"', defaultValue: 0 } as any))
      .toEqual({ expression: '__tc_prefs_get_float("tc/app/gain", 0)' });
  });

  it('get_bool renders the C++ bool literal default', () => {
    expect(lowerPreferences({ operation: 'preferences.get_bool', ns: 'app', key: '"flag"', defaultValue: false } as any))
      .toEqual({ expression: '__tc_prefs_get_bool("tc/app/flag", false)' });
    expect(lowerPreferences({ operation: 'preferences.get_bool', ns: 'app', key: '"flag"', defaultValue: true } as any))
      .toEqual({ expression: '__tc_prefs_get_bool("tc/app/flag", true)' });
  });

  it('get_string passes key + default', () => {
    expect(lowerPreferences({ operation: 'preferences.get_string', ns: 'app', key: '"label"', defaultValue: '""' } as any))
      .toEqual({ expression: '__tc_prefs_get_string("tc/app/label", "")' });
  });
});

describe('preferences lowering — classification', () => {
  // Statement ops produce { code }; value-returning ops produce { expression }.
  // This is the contract the typecad-hal synthesizer relies on to decide
  // whether to emit the result inline (expression) or as a standalone line
  // (statement). Getting it wrong either drops a return value or fails to
  // compile (an expression used as a statement).
  it('statement ops return { code } only', () => {
    const statementOps = [
      { operation: 'preferences.clear', ns: 'app' },
      { operation: 'preferences.remove', ns: 'app', key: '"k"' },
      { operation: 'preferences.put_int', ns: 'app', key: '"k"', value: 1 },
      { operation: 'preferences.put_bool', ns: 'app', key: '"k"', value: true },
      { operation: 'preferences.put_float', ns: 'app', key: '"k"', value: 1 },
      { operation: 'preferences.put_string', ns: 'app', key: '"k"', value: '"v"' },
    ];
    for (const op of statementOps) {
      const out = lowerPreferences(op as any);
      expect(out.code, `${op.operation} should be a statement`).toBeTypeOf('string');
      expect(out.expression, `${op.operation} must not be an expression`).toBeUndefined();
    }
  });

  it('value ops return { expression } only', () => {
    const valueOps = [
      { operation: 'preferences.get_int', ns: 'app', key: '"k"', defaultValue: 0 },
      { operation: 'preferences.get_bool', ns: 'app', key: '"k"', defaultValue: false },
      { operation: 'preferences.get_float', ns: 'app', key: '"k"', defaultValue: 0 },
      { operation: 'preferences.get_string', ns: 'app', key: '"k"', defaultValue: '""' },
    ];
    for (const op of valueOps) {
      const out = lowerPreferences(op as any);
      expect(out.expression, `${op.operation} should be an expression`).toBeTypeOf('string');
      expect(out.code, `${op.operation} must not be a statement`).toBeUndefined();
    }
  });
});

describe('preferences lowering — unknown op throws', () => {
  // The manifest validator probes every declared op; the default arm keeps a
  // bogus in-category op from silently returning undefined (which would make
  // an 'unsupported' declaration pass as honest). It must throw so the
  // failure surfaces during the manifest cross-check.
  it('throws on an unrecognized preferences.* op', () => {
    expect(() => lowerPreferences({ operation: 'preferences.bogus' } as any))
      .toThrow(/does not yet support/);
  });
});
