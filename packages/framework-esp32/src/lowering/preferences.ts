import type { HALOpIR } from '@typecad/cuttlefish/api/shared';

/**
 * Native ESP-IDF Preferences runtime shim (`__tc_prefs_*`). Pure nvs_flash /
 * nvs_open / nvs_set_* / nvs_get_* — no Arduino anywhere. Mirrors the HAL
 * Preferences surface: open a namespace once, then put/get typed values.
 *
 * Float has no native NVS type, so it is memcpy'd into a uint32_t and stored
 * via nvs_set_u32 / nvs_get_u32 (same approach framework-arduino's AVR
 * Preferences shim takes).
 *
 * All helpers are `static inline` so unused ones don't trip -Wunused-function
 * in the single generated TU.
 */
export function preferencesInitLines(): string[] {
  return [
    `// CUTTLEFISH_PREFERENCES_BEGIN`,
    `static struct {`,
    `    nvs_handle_t handle;       // cached across put/get calls until end()`,
    `    char namespace[16];        // current NVS namespace`,
    `    bool read_only;`,
    `    bool opened;`,
    `    bool nvs_inited;`,
    `} __tc_prefs = { 0, {0}, false, false, false };`,
    ``,
    `// nvs_flash_init can fail on a corrupt/changed partition; erase + retry once`,
    `// (mirrors the proven guard in __tc_wifi_ensure_init). Idempotent across the`,
    `// WiFi/BLE/Preferences shims — a second call returns ESP_ERR_INVALID_STATE.`,
    `static inline void __tc_prefs_ensure_nvs(void) {`,
    `    if (__tc_prefs.nvs_inited) return;`,
    `    esp_err_t err = nvs_flash_init();`,
    `    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {`,
    `        nvs_flash_erase();`,
    `        nvs_flash_init();`,
    `    }`,
    `    __tc_prefs.nvs_inited = true;`,
    `}`,
    ``,
    `static inline void __tc_prefs_begin(const char* ns, bool read_only) {`,
    `    __tc_prefs_ensure_nvs();`,
    `    if (__tc_prefs.opened) { nvs_close(__tc_prefs.handle); __tc_prefs.opened = false; }`,
    `    strlcpy(__tc_prefs.namespace, ns, sizeof(__tc_prefs.namespace));`,
    `    __tc_prefs.read_only = read_only;`,
    `    nvs_open_mode_t mode = read_only ? NVS_READONLY : NVS_READWRITE;`,
    `    // A read-only open fails if the namespace doesn't exist yet; that's expected`,
    `    // (callers fall back to defaults), so don't ESP_ERROR_CHECK here.`,
    `    __tc_prefs.opened = (nvs_open(__tc_prefs.namespace, mode, &__tc_prefs.handle) == ESP_OK);`,
    `}`,
    ``,
    `static inline void __tc_prefs_end(void) {`,
    `    if (__tc_prefs.opened) { nvs_close(__tc_prefs.handle); __tc_prefs.opened = false; }`,
    `}`,
    ``,
    `static inline void __tc_prefs_clear(void) {`,
    `    if (__tc_prefs.opened && !__tc_prefs.read_only) {`,
    `        nvs_erase_all(__tc_prefs.handle);`,
    `        nvs_commit(__tc_prefs.handle);`,
    `    }`,
    `}`,
    ``,
    `static inline void __tc_prefs_remove(const char* key) {`,
    `    if (__tc_prefs.opened && !__tc_prefs.read_only) {`,
    `        nvs_erase_key(__tc_prefs.handle, key);`,
    `        nvs_commit(__tc_prefs.handle);`,
    `    }`,
    `}`,
    ``,
    `// ── int32 ──`,
    `static inline void __tc_prefs_put_int(const char* key, int32_t value) {`,
    `    if (__tc_prefs.opened && !__tc_prefs.read_only) {`,
    `        nvs_set_i32(__tc_prefs.handle, key, value);`,
    `        nvs_commit(__tc_prefs.handle);`,
    `    }`,
    `}`,
    ``,
    `static inline int32_t __tc_prefs_get_int(const char* key, int32_t def) {`,
    `    int32_t v = def;`,
    `    if (__tc_prefs.opened) nvs_get_i32(__tc_prefs.handle, key, &v);  // NOT_FOUND → keeps def`,
    `    return v;`,
    `}`,
    ``,
    `// ── uint32 ──`,
    `static inline void __tc_prefs_put_uint(const char* key, uint32_t value) {`,
    `    if (__tc_prefs.opened && !__tc_prefs.read_only) {`,
    `        nvs_set_u32(__tc_prefs.handle, key, value);`,
    `        nvs_commit(__tc_prefs.handle);`,
    `    }`,
    `}`,
    ``,
    `static inline uint32_t __tc_prefs_get_uint(const char* key, uint32_t def) {`,
    `    uint32_t v = def;`,
    `    if (__tc_prefs.opened) nvs_get_u32(__tc_prefs.handle, key, &v);`,
    `    return v;`,
    `}`,
    ``,
    `// ── bool (stored as uint8) ──`,
    `static inline void __tc_prefs_put_bool(const char* key, bool value) {`,
    `    if (__tc_prefs.opened && !__tc_prefs.read_only) {`,
    `        nvs_set_u8(__tc_prefs.handle, key, value ? 1 : 0);`,
    `        nvs_commit(__tc_prefs.handle);`,
    `    }`,
    `}`,
    ``,
    `static inline bool __tc_prefs_get_bool(const char* key, bool def) {`,
    `    uint8_t v = def ? 1 : 0;`,
    `    if (__tc_prefs.opened) nvs_get_u8(__tc_prefs.handle, key, &v);`,
    `    return v != 0;`,
    `}`,
    ``,
    `// ── float (memcpy'd into uint32 — NVS has no native float type) ──`,
    `static inline void __tc_prefs_put_float(const char* key, float value) {`,
    `    if (__tc_prefs.opened && !__tc_prefs.read_only) {`,
    `        uint32_t bits;`,
    `        memcpy(&bits, &value, sizeof(bits));`,
    `        nvs_set_u32(__tc_prefs.handle, key, bits);`,
    `        nvs_commit(__tc_prefs.handle);`,
    `    }`,
    `}`,
    ``,
    `static inline float __tc_prefs_get_float(const char* key, float def) {`,
    `    uint32_t bits;`,
    `    float v = def;`,
    `    // Only decode if a value was actually stored (matches def otherwise).`,
    `    if (__tc_prefs.opened && nvs_get_u32(__tc_prefs.handle, key, &bits) == ESP_OK) {`,
    `        memcpy(&v, &bits, sizeof(v));`,
    `    }`,
    `    return v;`,
    `}`,
    ``,
    `// ── string ──`,
    `// get_string returns into a static buffer (one slot at a time, like the wifi`,
    `// scan helpers); valid until the next get_string call.`,
    `static inline void __tc_prefs_put_string(const char* key, const char* value) {`,
    `    if (__tc_prefs.opened && !__tc_prefs.read_only) {`,
    `        nvs_set_str(__tc_prefs.handle, key, value);`,
    `        nvs_commit(__tc_prefs.handle);`,
    `    }`,
    `}`,
    ``,
    `static inline const char* __tc_prefs_get_string(const char* key, const char* def) {`,
    `    static char buf[256];`,
    `    size_t len = sizeof(buf);`,
    `    if (!__tc_prefs.opened || nvs_get_str(__tc_prefs.handle, key, buf, &len) != ESP_OK) {`,
    `        strlcpy(buf, def, sizeof(buf));`,
    `    }`,
    `    return buf;`,
    `}`,
    `// CUTTLEFISH_PREFERENCES_END`,
    ``,
  ];
}

/** Render a HAL field: pass through (already rendered by the resolver). */
function s(v: unknown): string {
  return String(v);
}

/** Resolve a HAL preferences.* op to native ESP-IDF C++ (via the __tc_prefs shim). */
export function lowerPreferences(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  switch (op.operation) {
    case 'preferences.begin':
      return { code: `__tc_prefs_begin(${s(o.namespace)}, ${o.readOnly ? 'true' : 'false'});` };
    case 'preferences.end':
      return { code: `__tc_prefs_end();` };
    case 'preferences.clear':
      return { code: `__tc_prefs_clear();` };
    case 'preferences.remove':
      return { code: `__tc_prefs_remove(${s(o.key)});` };
    case 'preferences.put_int':
      return { code: `__tc_prefs_put_int(${s(o.key)}, ${s(o.value)});` };
    case 'preferences.get_int':
      return { expression: `__tc_prefs_get_int(${s(o.key)}, ${s(o.defaultValue)})` };
    case 'preferences.put_uint':
      return { code: `__tc_prefs_put_uint(${s(o.key)}, ${s(o.value)});` };
    case 'preferences.get_uint':
      return { expression: `__tc_prefs_get_uint(${s(o.key)}, ${s(o.defaultValue)})` };
    case 'preferences.put_bool':
      return { code: `__tc_prefs_put_bool(${s(o.key)}, ${o.value ? 'true' : 'false'});` };
    case 'preferences.get_bool':
      return { expression: `__tc_prefs_get_bool(${s(o.key)}, ${o.defaultValue ? 'true' : 'false'})` };
    case 'preferences.put_float':
      return { code: `__tc_prefs_put_float(${s(o.key)}, ${s(o.value)});` };
    case 'preferences.get_float':
      return { expression: `__tc_prefs_get_float(${s(o.key)}, ${s(o.defaultValue)})` };
    case 'preferences.put_string':
      return { code: `__tc_prefs_put_string(${s(o.key)}, ${s(o.value)});` };
    case 'preferences.get_string':
      return { expression: `__tc_prefs_get_string(${s(o.key)}, ${s(o.defaultValue)})` };
    default:
      throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`.`);
  }
}
