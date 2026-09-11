// ---------------------------------------------------------------------------
// Store — the thin persistent key/value store
//
// The namespace is the CONSTRUCTION fact: `new Store('app')` rides every op
// as the settings subtree prefix (tc/app/<key> on Zephyr's settings/ZMS
// backend). There is no session to open or close — the backend loads once at
// boot and every verb maps 1:1 onto a settings write/read/delete:
//
//   setInt/getInt, setFloat/getFloat, setBool/getBool,
//   setString/getString  — typed pairs; get takes a REQUIRED default (no
//                          hidden = 0 magic value)
//   remove(key)          → settings_delete
//   clear()              → delete every tc/<ns>/* key this app wrote
//
// Values survive re-flashing the application: they live in the board's
// storage partition, not the app image.
// ----------------------------------------------------------------------------

import {
  preferencesPutInt, preferencesGetInt,
  preferencesPutFloat, preferencesGetFloat,
  preferencesPutBool, preferencesGetBool,
  preferencesPutString, preferencesGetString,
  preferencesRemove, preferencesClear,
} from './emit.js';

/**
 * A persistent key/value store: `const store = new Store('app')`. Typed
 * get/set pairs for int/float/bool/string — every get takes an explicit
 * default, returned when the key has never been set. Values persist
 * across re-flashing the application: they live in the board's storage
 * partition, not the app image.
 */
export class Store {
  private readonly _ns: string;

  /** Construct the store for a namespace — separate namespaces keep
   *  their keys apart ('app', 'calibration', …). */
  constructor(ns: string) {
    this._ns = ns;
  }

  /** Store an integer. */
  setInt(key: string, value: number): void {
    preferencesPutInt(this._ns, key, value);
  }

  /** Read an integer — `defaultValue` when the key was never set. */
  getInt(key: string, defaultValue: number): number {
    return preferencesGetInt(this._ns, key, defaultValue);
  }

  /** Store a float. */
  setFloat(key: string, value: number): void {
    preferencesPutFloat(this._ns, key, value);
  }

  /** Read a float — `defaultValue` when the key was never set. */
  getFloat(key: string, defaultValue: number): number {
    return preferencesGetFloat(this._ns, key, defaultValue);
  }

  /** Store a boolean. */
  setBool(key: string, value: boolean): void {
    preferencesPutBool(this._ns, key, value);
  }

  /** Read a boolean — `defaultValue` when the key was never set. */
  getBool(key: string, defaultValue: boolean): boolean {
    return preferencesGetBool(this._ns, key, defaultValue);
  }

  /** Store a string. */
  setString(key: string, value: string): void {
    preferencesPutString(this._ns, key, value);
  }

  /** Read a string — `defaultValue` when the key was never set. The
   *  returned string is valid until the next get — copy it if you need
   *  to keep it. */
  getString(key: string, defaultValue: string): string {
    return preferencesGetString(this._ns, key, defaultValue);
  }

  /** Delete one key (flash + cache). No-op when absent. */
  remove(key: string): void {
    preferencesRemove(this._ns, key);
  }

  /** Delete every key under this store's namespace. */
  clear(): void {
    preferencesClear(this._ns);
  }
}
