// ---------------------------------------------------------------------------
// Preferences lowering — Zephyr settings subsystem (ZMS backend)
//
// The HAL Preferences surface is the ESP32-NVS session model: begin(ns) →
// typed put_*/get_* → end(). Zephyr's settings subsystem has no session — it
// is a flat dotted key-space plus a one-time settings_load() at boot that
// fills an in-RAM cache via the h_set callback. We model the session on top:
//
//   begin("app")   → records the active subtree prefix "tc/app/"
//   putInt("k",v)  → writes the cache + settings_save_one("tc/app/k", bytes, 4)
//   getInt("k",d)  → cache lookup, returns d if absent
//   remove("k")    → settings_delete("tc/app/k") + drop cache slot
//   clear()        → settings_delete each known tc/<ns>/* key + clear cache
//   end()          → clears the prefix (NOT the cache — end() is not a wipe on
//                    ESP32 either; it only closes the NVS handle)
//
// begin/end are intentionally lightweight on Zephyr. They stay in the IR so a
// future backend that genuinely needs a session/namespace (NVS, a crypto-
// sealed store) has the hook without lowering every read through setup. On
// Zephyr they only carry the key prefix.
//
// The settings backend is ZMS (Zephyr Memory Storage), selected by
// CONFIG_SETTINGS + CONFIG_ZMS + CONFIG_SETTINGS_ZMS. The backend locates the
// storage partition automatically: the fixed-partition labeled
// `storage_partition`, or whatever /chosen `zephyr,settings-partition` points
// at (see dt-config/overlay.ts). No partition macro is referenced here.
//
// EMIT BOUNDARY: emitted bytes land in user firmware. Covered by the TypeCAD
// Runtime Exception (RUNTIME_EXCEPTION.md at the repo root).
// ---------------------------------------------------------------------------

import type { HALOpIR } from '@typecad/cuttlefish/api/shared';

/** Render a HAL field: pass through (already rendered by the resolver). */
function unq(v: unknown): string {
  return String(v).replace(/^"|"$/g, '');
}

function s(v: unknown): string {
  return String(v);
}

// Type tags for the cache slot payload. Scoped enum (AUTOSAR: enum class).
// The on-metal order matters: these are stored in the `type` byte and matched
// at h_set time, so do not renumber.
const TAG = {
  INT: 1,
  UINT: 2,
  BOOL: 3,
  FLOAT: 4,
  STRING: 5,
} as const;

/**
 * The preferences runtime shim. All helpers are `static`/`inline` so unused
 * ones don't trip -Wunused-function in the single generated TU (mirrors
 * wifi.ts / http.ts / mqtt.ts).
 *
 * The cache is the source of truth at runtime: settings_load() repopulates it
 * once at boot via h_set, and every put / get / remove reads or writes it
 * directly. settings_save_one and settings_delete keep flash in sync on
 * writes; reads never touch flash. This is the same split the ESP32
 * Preferences library uses (NVS is the cache, just in flash-backed RAM pages).
 */
export function preferencesInitLines(): string[] {
  return [
    `// CUTTLEFISH_PREFS_BEGIN`,
    `#define __TC_PREFS_SLOT_COUNT 32`,
    `#define __TC_PREFS_KEY_LEN   48`,
    `#define __TC_PREFS_VAL_LEN   32`,
    `#define __TC_PREFS_STR_LEN   31`,
    ``,
    `// One cache slot. The full settings key (tc/<ns>/<key>) lives in key[] so`,
    `// remove()/clear() can reconstruct the exact name to settings_delete. The`,
    `// value is stored in its native wire form (little-endian for the numeric`,
    `// types) so h_set can memcpy straight from the settings read callback.`,
    `struct __tc_prefs_slot final {`,
    `    char key[__TC_PREFS_KEY_LEN];`,
    `    uint8_t type;`,
    `    uint8_t val[__TC_PREFS_VAL_LEN];`,
    `    uint8_t len;`,
    `    bool used;`,
    `};`,
    ``,
    `static struct {`,
    `    bool loaded;`,
    `    __tc_prefs_slot slots[__TC_PREFS_SLOT_COUNT];`,
    `} __tc_prefs;`,
    ``,
    `// ── settings_load() handler (the only mandatory callback) ───────────────`,
    `// settings_load() calls h_set once per stored key it finds, handing us the`,
    `// value via read_cb. We copy it into a cache slot keyed by the full dotted`,
    `// path. h_get/h_commit are unused (the cache is the post-load source of`,
    `// truth) so they return -ENOENT / 0 to satisfy the handler contract.`,
    `static int __tc_prefs_h_set(const char* name, size_t len, settings_read_cb read_cb, void* cb_arg) {`,
    `    (void)len;`,
    `    for (int i = 0; i < __TC_PREFS_SLOT_COUNT; i++) {`,
    `        if (!__tc_prefs.slots[i].used) {`,
    `            // Stash the type byte (first val byte) by reading into the slot.`,
    `            ssize_t got = read_cb(cb_arg, __tc_prefs.slots[i].val, __TC_PREFS_VAL_LEN);`,
    `            if (got <= 0) { return static_cast<int>(got); }`,
    `            __tc_prefs.slots[i].len = static_cast<uint8_t>(got);`,
    `            // Type is encoded as the first byte of the stored value (see put_*).`,
    `            __tc_prefs.slots[i].type = __tc_prefs.slots[i].val[0];`,
    `            // h_set hands us the name RELATIVE to the handler's "tc"`,
    `            // subtree ("rig/marker") — the cache keys full names, so`,
    `            // re-attach the prefix or loaded entries never match a lookup.`,
    `            (void)snprintf(__tc_prefs.slots[i].key, __TC_PREFS_KEY_LEN, "tc/%s", name);`,
    `            __tc_prefs.slots[i].used = true;`,
    `            return 0;`,
    `        }`,
    `    }`,
    `    return 0;  // cache full — silently drop (matches ESP32 NVS-full behavior)`,
    `}`,
    `static int __tc_prefs_h_get(const char* full, char* val, int val_len_max) {`,
    `    (void)full; (void)val; (void)val_len_max;`,
    `    return -ENOENT;`,
    `}`,
    `static int __tc_prefs_h_commit(void) { return 0; }`,
    `SETTINGS_STATIC_HANDLER_DEFINE(tc_prefs, "tc", __tc_prefs_h_get, __tc_prefs_h_set,`,
    `                                __tc_prefs_h_commit, NULL);`,
    ``,
    `// One-time subsystem init + load. Idempotent — the HAL may call begin()`,
    `// repeatedly. settings_subsys_init() is itself idempotent in Zephyr, but the`,
    `// loaded flag short-circuits the (relatively expensive) settings_load() walk.`,
    `static inline void __tc_prefs_ensure_loaded(void) {`,
    `    if (!__tc_prefs.loaded) {`,
    `        (void)settings_subsys_init();`,
    `        (void)settings_load();`,
    `        __tc_prefs.loaded = true;`,
    `    }`,
    `}`,
    ``,
    ``,
    `// Slot lookup by full settings name. Returns nullptr when absent (the get_*`,
    `// helpers then fall back to the caller's default value, matching the ESP32`,
    `// getInt(key, default) contract).`,
    `static __tc_prefs_slot* __tc_prefs_find(const char* full) {`,
    `    for (int i = 0; i < __TC_PREFS_SLOT_COUNT; i++) {`,
    `        if (__tc_prefs.slots[i].used &&`,
    `            strncmp(__tc_prefs.slots[i].key, full, __TC_PREFS_KEY_LEN) == 0) {`,
    `            return &__tc_prefs.slots[i];`,
    `        }`,
    `    }`,
    `    return nullptr;`,
    `}`,
    ``,
    `// Allocate (or reuse) a slot for a full name. Eviction is last-write on a`,
    `// free slot; a full cache returns nullptr and the put silently no-ops (the`,
    `// in-RAM value is still returned to the program on get, just not persisted).`,
    `static __tc_prefs_slot* __tc_prefs_slot_for(const char* full) {`,
    `    __tc_prefs_slot* existing = __tc_prefs_find(full);`,
    `    if (existing != nullptr) { return existing; }`,
    `    for (int i = 0; i < __TC_PREFS_SLOT_COUNT; i++) {`,
    `        if (!__tc_prefs.slots[i].used) { return &__tc_prefs.slots[i]; }`,
    `    }`,
    `    return nullptr;`,
    `}`,
    ``,
    `// Generic typed put: stamp the type byte, stash the value, persist via`,
    `// settings_save_one, and mirror into the cache. The type byte rides along`,
    `// as val[0] so h_set can recover it on the next boot without a separate`,
    `// name→type map.`,
    `template <typename T>`,
    `static inline void __tc_prefs_put(const char* full, uint8_t tag, const T& value) {`,
    `    __tc_prefs_ensure_loaded();   // begin() is gone — mount lazily here`,
    `    uint8_t buf[1U + sizeof(T)];`,
    `    buf[0] = tag;`,
    `    (void)memcpy(&buf[1], &value, sizeof(T));`,
    `    (void)settings_save_one(full, buf, sizeof(buf));`,
    `    __tc_prefs_slot* slot = __tc_prefs_slot_for(full);`,
    `    if (slot != nullptr) {`,
    `        (void)snprintf(slot->key, __TC_PREFS_KEY_LEN, "%s", full);`,
    `        slot->type = tag;`,
    `        slot->len = static_cast<uint8_t>(sizeof(buf));`,
    `        (void)memcpy(slot->val, buf, sizeof(buf));`,
    `        slot->used = true;`,
    `    }`,
    `}`,
    ``,
    `template <typename T>`,
    `static inline T __tc_prefs_get(const char* full, uint8_t tag, T def) {`,
    `    __tc_prefs_ensure_loaded();`,
    `    __tc_prefs_slot* slot = __tc_prefs_find(full);`,
    `    if (slot == nullptr || slot->type != tag || slot->len < (1U + sizeof(T))) {`,
    `        return def;`,
    `    }`,
    `    T out;`,
    `    (void)memcpy(&out, &slot->val[1], sizeof(T));`,
    `    return out;`,
    `}`,
    ``,
    `// ── Lifecycle (session model on top of the flat key-space) ──────────────`,
    `// begin records "tc/<ns>/" as the prefix every subsequent key is built under.`,
    `// end clears the prefix (NOT the cache). Both are cheap on Zephyr: the real`,
    ``,
    `// remove: drop one key from flash and the cache. Falls back to no-op if the`,
    `// slot isn't cached (settings_delete on a missing key returns -ENOENT, which`,
    `// we swallow).`,
    `static inline void __tc_prefs_remove(const char* full) {`,
    `    __tc_prefs_ensure_loaded();`,
    `    (void)settings_delete(full);`,
    `    __tc_prefs_slot* slot = __tc_prefs_find(full);`,
    `    if (slot != nullptr) { slot->used = false; }`,
    `}`,
    ``,
    `// clear: drop every key under the active namespace. We walk the cache (the`,
    `// authoritative list of keys we have written) and settings_delete each whose`,
    `// full name starts with the active ns prefix, then mark the slot free. Only`,
    `// the active namespace is cleared — keys under other namespaces survive.`,
    `static inline void __tc_prefs_clear(const char* prefix) {`,
    `    __tc_prefs_ensure_loaded();`,
    `    const size_t plen = strlen(prefix);`,
    `    for (int i = 0; i < __TC_PREFS_SLOT_COUNT; i++) {`,
    `        if (__tc_prefs.slots[i].used &&`,
    `            strncmp(__tc_prefs.slots[i].key, prefix, plen) == 0) {`,
    `            (void)settings_delete(__tc_prefs.slots[i].key);`,
    `            __tc_prefs.slots[i].used = false;`,
    `        }`,
    `    }`,
    `}`,
    ``,
    `// ── Typed accessors ─────────────────────────────────────────────────────`,
    `// Each put_* stamps its tag byte and persists; each get_* reads the cache and`,
    `// returns the default on miss/type-mismatch (mirrors ESP32 Preferences).`,
    `static inline void __tc_prefs_put_int(const char* full, int32_t v) {`,
    `    __tc_prefs_put<int32_t>(full, ${TAG.INT}, v);`,
    `}`,
    `static inline int32_t __tc_prefs_get_int(const char* full, int32_t def) {`,
    `    return __tc_prefs_get<int32_t>(full, ${TAG.INT}, def);`,
    `}`,
    `static inline void __tc_prefs_put_uint(const char* full, uint32_t v) {`,
    `    __tc_prefs_put<uint32_t>(full, ${TAG.UINT}, v);`,
    `}`,
    `static inline uint32_t __tc_prefs_get_uint(const char* full, uint32_t def) {`,
    `    return __tc_prefs_get<uint32_t>(full, ${TAG.UINT}, def);`,
    `}`,
    `static inline void __tc_prefs_put_bool(const char* full, bool v) {`,
    `    uint8_t b = v ? 1U : 0U;`,
    `    __tc_prefs_put<uint8_t>(full, ${TAG.BOOL}, b);`,
    `}`,
    `static inline bool __tc_prefs_get_bool(const char* full, bool def) {`,
    `    uint8_t b = __tc_prefs_get<uint8_t>(full, ${TAG.BOOL}, def ? 1U : 0U);`,
    `    return b != 0U;`,
    `}`,
    `static inline void __tc_prefs_put_float(const char* full, float v) {`,
    `    __tc_prefs_put<float>(full, ${TAG.FLOAT}, v);`,
    `}`,
    `static inline float __tc_prefs_get_float(const char* full, float def) {`,
    `    return __tc_prefs_get<float>(full, ${TAG.FLOAT}, def);`,
    `}`,
    ``,
    `// Strings are length-prefixed into the value buffer (capped at STR_LEN so the`,
    `// whole slot still fits in __TC_PREFS_VAL_LEN). get copies out with a NUL and`,
    `// returns def when the slot is absent or the wrong type.`,
    `static inline void __tc_prefs_put_string(const char* full, const char* v) {`,
    `    __tc_prefs_ensure_loaded();`,
    `    uint8_t buf[1U + __TC_PREFS_STR_LEN];`,
    `    buf[0] = ${TAG.STRING};`,
    `    size_t n = strlen(v);`,
    `    if (n > __TC_PREFS_STR_LEN) { n = __TC_PREFS_STR_LEN; }`,
    `    (void)memcpy(&buf[1], v, n);`,
    `    (void)settings_save_one(full, buf, 1U + n);`,
    `    __tc_prefs_slot* slot = __tc_prefs_slot_for(full);`,
    `    if (slot != nullptr) {`,
    `        (void)snprintf(slot->key, __TC_PREFS_KEY_LEN, "%s", full);`,
    `        slot->type = ${TAG.STRING};`,
    `        slot->len = static_cast<uint8_t>(1U + static_cast<uint8_t>(n));`,
    `        (void)memcpy(slot->val, buf, 1U + n);`,
    `        slot->used = true;`,
    `    }`,
    `}`,
    `static inline const char* __tc_prefs_get_string(const char* full, const char* def) {`,
    `    __tc_prefs_ensure_loaded();`,
    `    static char out[__TC_PREFS_STR_LEN + 1U];`,
    `    __tc_prefs_slot* slot = __tc_prefs_find(full);`,
    `    if (slot == nullptr || slot->type != ${TAG.STRING} || slot->len < 1U) {`,
    `        return def;`,
    `    }`,
    `    size_t n = slot->len - 1U;`,
    `    if (n > __TC_PREFS_STR_LEN) { n = __TC_PREFS_STR_LEN; }`,
    `    (void)memcpy(out, &slot->val[1], n);`,
    `    out[n] = '\\0';`,
    `    return out;`,
    `}`,
    `// CUTTLEFISH_PREFS_END`,
    ``,
  ];
}

/**
 * Resolve a HAL preferences.* op to Zephyr C++ via the __tc_prefs_* shim.
 * Returns `{ code }` for statement ops, `{ expression }` for value-returning
 * ops (the get_* family). The `default` arm throws the standard unsupported-op
 * error so the manifest validator's per-op probe stays honest.
 */
export function lowerPreferences(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;

  switch (op.operation) {
    case 'preferences.clear':
      return { code: `__tc_prefs_clear("tc/${unq(o.ns)}/");` };
    case 'preferences.remove':
      return { code: `__tc_prefs_remove("tc/${unq(o.ns)}/${unq(o.key)}");` };
    case 'preferences.put_int':
      return { code: `__tc_prefs_put_int("tc/${unq(o.ns)}/${unq(o.key)}", ${s(o.value)});` };
    case 'preferences.get_int':
      return { expression: `__tc_prefs_get_int("tc/${unq(o.ns)}/${unq(o.key)}", ${s(o.defaultValue)})` };
    case 'preferences.put_bool':
      return { code: `__tc_prefs_put_bool("tc/${unq(o.ns)}/${unq(o.key)}", ${o.value ? 'true' : 'false'});` };
    case 'preferences.get_bool':
      return { expression: `__tc_prefs_get_bool("tc/${unq(o.ns)}/${unq(o.key)}", ${o.defaultValue ? 'true' : 'false'})` };
    case 'preferences.put_float':
      return { code: `__tc_prefs_put_float("tc/${unq(o.ns)}/${unq(o.key)}", ${s(o.value)});` };
    case 'preferences.get_float':
      return { expression: `__tc_prefs_get_float("tc/${unq(o.ns)}/${unq(o.key)}", ${s(o.defaultValue)})` };
    case 'preferences.put_string':
      return { code: `__tc_prefs_put_string("tc/${unq(o.ns)}/${unq(o.key)}", ${s(o.value)});` };
    case 'preferences.get_string':
      return { expression: `__tc_prefs_get_string("tc/${unq(o.ns)}/${unq(o.key)}", ${s(o.defaultValue)})` };
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
