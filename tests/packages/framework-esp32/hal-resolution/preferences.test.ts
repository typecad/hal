import { describe, it, expect } from 'vitest';
import { lowerPreferences, preferencesInitLines } from '../../../../packages/framework-esp32/src/lowering/preferences';

describe('preferences init block', () => {
  it('emits CUTTLEFISH_PREFERENCES markers', () => {
    const lines = preferencesInitLines().join('\n');
    expect(lines).toContain('// CUTTLEFISH_PREFERENCES_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_PREFERENCES_END');
  });

  it('declares the __tc_prefs singleton with a cached nvs handle', () => {
    const lines = preferencesInitLines().join('\n');
    expect(lines).toContain('__tc_prefs');
    expect(lines).toContain('nvs_handle_t');
  });

  it('inits nvs_flash once with the erase/retry guard', () => {
    // Mirrors the proven wifi saved-credentials pattern: nvs_flash_init can
    // return ESP_ERR_NVS_NO_FREE_PAGES / ESP_ERR_NVS_NEW_VERSION_FOUND on a
    // corrupt/changed partition, which warrant erase + retry.
    const lines = preferencesInitLines().join('\n');
    expect(lines).toContain('nvs_flash_init');
    expect(lines).toContain('ESP_ERR_NVS_NO_FREE_PAGES');
    expect(lines).toContain('nvs_flash_erase');
  });

  it('opens the namespace lazily via an ensure-open helper', () => {
    const lines = preferencesInitLines().join('\n');
    expect(lines).toMatch(/__tc_prefs_ensure_open|__tc_prefs_ensure/);
    expect(lines).toContain('nvs_open');
  });

  it('closes the handle on end()', () => {
    const lines = preferencesInitLines().join('\n');
    expect(lines).toContain('nvs_close');
  });
});

describe('preferences lowering — lifecycle', () => {
  it('begin → __tc_prefs_begin(namespace, readOnly); statement', () => {
    expect(lowerPreferences({ operation: 'preferences.begin', namespace: '"myapp"', readOnly: false }))
      .toEqual({ code: '__tc_prefs_begin("myapp", false);' });
  });

  it('begin readOnly=true', () => {
    expect(lowerPreferences({ operation: 'preferences.begin', namespace: '"myapp"', readOnly: true }))
      .toEqual({ code: '__tc_prefs_begin("myapp", true);' });
  });

  it('end → __tc_prefs_end(); statement', () => {
    expect(lowerPreferences({ operation: 'preferences.end' })).toEqual({ code: '__tc_prefs_end();' });
  });

  it('clear → __tc_prefs_clear(); statement', () => {
    expect(lowerPreferences({ operation: 'preferences.clear' })).toEqual({ code: '__tc_prefs_clear();' });
  });

  it('remove → __tc_prefs_remove(key); statement', () => {
    expect(lowerPreferences({ operation: 'preferences.remove', key: '"count"' }))
      .toEqual({ code: '__tc_prefs_remove("count");' });
  });
});

describe('preferences lowering — int / uint', () => {
  it('put_int → __tc_prefs_put_int(key, value); statement', () => {
    expect(lowerPreferences({ operation: 'preferences.put_int', key: '"count"', value: 42 }))
      .toEqual({ code: '__tc_prefs_put_int("count", 42);' });
  });
  it('get_int → __tc_prefs_get_int(key, default) expression', () => {
    expect(lowerPreferences({ operation: 'preferences.get_int', key: '"count"', defaultValue: 0 }))
      .toEqual({ expression: '__tc_prefs_get_int("count", 0)' });
  });
  it('put_uint → __tc_prefs_put_uint(key, value); statement', () => {
    expect(lowerPreferences({ operation: 'preferences.put_uint', key: '"total"', value: 100 }))
      .toEqual({ code: '__tc_prefs_put_uint("total", 100);' });
  });
  it('get_uint → __tc_prefs_get_uint(key, default) expression', () => {
    expect(lowerPreferences({ operation: 'preferences.get_uint', key: '"total"', defaultValue: 0 }))
      .toEqual({ expression: '__tc_prefs_get_uint("total", 0)' });
  });
});

describe('preferences lowering — bool / float / string', () => {
  it('put_bool → __tc_prefs_put_bool(key, value); statement', () => {
    expect(lowerPreferences({ operation: 'preferences.put_bool', key: '"on"', value: true }))
      .toEqual({ code: '__tc_prefs_put_bool("on", true);' });
  });
  it('get_bool → __tc_prefs_get_bool(key, default) expression', () => {
    expect(lowerPreferences({ operation: 'preferences.get_bool', key: '"on"', defaultValue: false }))
      .toEqual({ expression: '__tc_prefs_get_bool("on", false)' });
  });
  it('put_float → __tc_prefs_put_float(key, value); statement', () => {
    expect(lowerPreferences({ operation: 'preferences.put_float', key: '"temp"', value: 36.5 }))
      .toEqual({ code: '__tc_prefs_put_float("temp", 36.5);' });
  });
  it('get_float → __tc_prefs_get_float(key, default) expression', () => {
    expect(lowerPreferences({ operation: 'preferences.get_float', key: '"temp"', defaultValue: 0 }))
      .toEqual({ expression: '__tc_prefs_get_float("temp", 0)' });
  });
  it('put_string → __tc_prefs_put_string(key, value); statement', () => {
    expect(lowerPreferences({ operation: 'preferences.put_string', key: '"ssid"', value: '"home"' }))
      .toEqual({ code: '__tc_prefs_put_string("ssid", "home");' });
  });
  it('get_string → __tc_prefs_get_string(key, default) expression', () => {
    expect(lowerPreferences({ operation: 'preferences.get_string', key: '"ssid"', defaultValue: '""' }))
      .toEqual({ expression: '__tc_prefs_get_string("ssid", "")' });
  });
});

describe('preferences lowering — error handling', () => {
  it('unknown preferences.* op throws', () => {
    expect(() => lowerPreferences({ operation: 'preferences.unknown' } as any)).toThrow(/does not yet support/);
  });
});
