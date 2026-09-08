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

export class Store {
  private readonly _ns: string;

  /** Construct the store for a namespace ('app' → settings subtree tc/app/). */
  constructor(ns: string) {
    this._ns = ns;
  }

  setInt(key: string, value: number): void {
    preferencesPutInt(this._ns, key, value);
  }

  getInt(key: string, defaultValue: number): number {
    return preferencesGetInt(this._ns, key, defaultValue);
  }

  setFloat(key: string, value: number): void {
    preferencesPutFloat(this._ns, key, value);
  }

  getFloat(key: string, defaultValue: number): number {
    return preferencesGetFloat(this._ns, key, defaultValue);
  }

  setBool(key: string, value: boolean): void {
    preferencesPutBool(this._ns, key, value);
  }

  getBool(key: string, defaultValue: boolean): boolean {
    return preferencesGetBool(this._ns, key, defaultValue);
  }

  setString(key: string, value: string): void {
    preferencesPutString(this._ns, key, value);
  }

  /** Read a string back. The value lands in the shim's ring buffer — copy
   *  what you need before the next get on the same key. */
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
