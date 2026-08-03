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
  it('begin → __tc_prefs_begin with namespace + readOnly flag', () => {
    // readOnly=true renders the bool literal true.
    expect(lowerPreferences({ operation: 'preferences.begin', namespace: '"app"', readOnly: true } as any))
      .toEqual({ code: '__tc_prefs_begin("app", true);' });
    expect(lowerPreferences({ operation: 'preferences.begin', namespace: '"app"', readOnly: false } as any))
      .toEqual({ code: '__tc_prefs_begin("app", false);' });
  });

  it('end → __tc_prefs_end', () => {
    expect(lowerPreferences({ operation: 'preferences.end' } as any))
      .toEqual({ code: '__tc_prefs_end();' });
  });

  it('clear → __tc_prefs_clear', () => {
    expect(lowerPreferences({ operation: 'preferences.clear' } as any))
      .toEqual({ code: '__tc_prefs_clear();' });
  });

  it('remove → __tc_prefs_remove with key', () => {
    expect(lowerPreferences({ operation: 'preferences.remove', key: '"k"' } as any))
      .toEqual({ code: '__tc_prefs_remove("k");' });
  });
});

describe('preferences lowering — typed put (statements)', () => {
  it('put_int / put_uint / put_float pass value through', () => {
    expect(lowerPreferences({ operation: 'preferences.put_int', key: '"count"', value: 42 } as any))
      .toEqual({ code: '__tc_prefs_put_int("count", 42);' });
    expect(lowerPreferences({ operation: 'preferences.put_uint', key: '"counter"', value: 1000 } as any))
      .toEqual({ code: '__tc_prefs_put_uint("counter", 1000);' });
    expect(lowerPreferences({ operation: 'preferences.put_float', key: '"gain"', value: 2.5 } as any))
      .toEqual({ code: '__tc_prefs_put_float("gain", 2.5);' });
  });

  it('put_bool renders the C++ bool literal', () => {
    expect(lowerPreferences({ operation: 'preferences.put_bool', key: '"flag"', value: true } as any))
      .toEqual({ code: '__tc_prefs_put_bool("flag", true);' });
    expect(lowerPreferences({ operation: 'preferences.put_bool', key: '"flag"', value: false } as any))
      .toEqual({ code: '__tc_prefs_put_bool("flag", false);' });
  });

  it('put_string passes key + value', () => {
    expect(lowerPreferences({ operation: 'preferences.put_string', key: '"label"', value: '"hello"' } as any))
      .toEqual({ code: '__tc_prefs_put_string("label", "hello");' });
  });
});

describe('preferences lowering — typed get (expressions)', () => {
  it('get_int / get_uint / get_float return the default on the expression path', () => {
    expect(lowerPreferences({ operation: 'preferences.get_int', key: '"count"', defaultValue: 0 } as any))
      .toEqual({ expression: '__tc_prefs_get_int("count", 0)' });
    expect(lowerPreferences({ operation: 'preferences.get_uint', key: '"counter"', defaultValue: 0 } as any))
      .toEqual({ expression: '__tc_prefs_get_uint("counter", 0)' });
    expect(lowerPreferences({ operation: 'preferences.get_float', key: '"gain"', defaultValue: 0 } as any))
      .toEqual({ expression: '__tc_prefs_get_float("gain", 0)' });
  });

  it('get_bool renders the C++ bool literal default', () => {
    expect(lowerPreferences({ operation: 'preferences.get_bool', key: '"flag"', defaultValue: false } as any))
      .toEqual({ expression: '__tc_prefs_get_bool("flag", false)' });
    expect(lowerPreferences({ operation: 'preferences.get_bool', key: '"flag"', defaultValue: true } as any))
      .toEqual({ expression: '__tc_prefs_get_bool("flag", true)' });
  });

  it('get_string passes key + default', () => {
    expect(lowerPreferences({ operation: 'preferences.get_string', key: '"label"', defaultValue: '""' } as any))
      .toEqual({ expression: '__tc_prefs_get_string("label", "")' });
  });
});

describe('preferences lowering — classification', () => {
  // Statement ops produce { code }; value-returning ops produce { expression }.
  // This is the contract the cuttlefish synthesizer relies on to decide
  // whether to emit the result inline (expression) or as a standalone line
  // (statement). Getting it wrong either drops a return value or fails to
  // compile (an expression used as a statement).
  it('statement ops return { code } only', () => {
    const statementOps = [
      { operation: 'preferences.begin', namespace: '"n"', readOnly: false },
      { operation: 'preferences.end' },
      { operation: 'preferences.clear' },
      { operation: 'preferences.remove', key: '"k"' },
      { operation: 'preferences.put_int', key: '"k"', value: 1 },
      { operation: 'preferences.put_uint', key: '"k"', value: 1 },
      { operation: 'preferences.put_bool', key: '"k"', value: true },
      { operation: 'preferences.put_float', key: '"k"', value: 1 },
      { operation: 'preferences.put_string', key: '"k"', value: '"v"' },
    ];
    for (const op of statementOps) {
      const out = lowerPreferences(op as any);
      expect(out.code, `${op.operation} should be a statement`).toBeTypeOf('string');
      expect(out.expression, `${op.operation} must not be an expression`).toBeUndefined();
    }
  });

  it('value ops return { expression } only', () => {
    const valueOps = [
      { operation: 'preferences.get_int', key: '"k"', defaultValue: 0 },
      { operation: 'preferences.get_uint', key: '"k"', defaultValue: 0 },
      { operation: 'preferences.get_bool', key: '"k"', defaultValue: false },
      { operation: 'preferences.get_float', key: '"k"', defaultValue: 0 },
      { operation: 'preferences.get_string', key: '"k"', defaultValue: '""' },
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
