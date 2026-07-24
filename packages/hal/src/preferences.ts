import {
  preferencesBegin,
  preferencesEnd,
  preferencesClear,
  preferencesRemove,
  preferencesPutInt,
  preferencesGetInt,
  preferencesPutUInt,
  preferencesGetUInt,
  preferencesPutBool,
  preferencesGetBool,
  preferencesPutFloat,
  preferencesGetFloat,
  preferencesPutString,
  preferencesGetString,
} from './emit.js';

/**
 * Preferences — a persistent key/value store, lowered to native NVS
 * (nvs_flash / nvs_open / nvs_set_* / nvs_get_*) by framework-esp32.
 *
 * No include() calls here — NVS headers are framework-owned and added via
 * forcedIncludes when the program uses preferences.* ops. Method bodies pass
 * parameters directly into semantic calls so the resolver can statically track
 * every argument (matching the WiFi/HTTP HAL pattern).
 */
export class PreferencesClass {
  static readonly __instance_name = "Preferences";

  begin(name: string, readOnly: boolean = false): void {
    preferencesBegin(name, readOnly);
  }

  end(): void {
    preferencesEnd();
  }

  clear(): void {
    preferencesClear();
  }

  remove(key: string): void {
    preferencesRemove(key);
  }

  putInt(key: string, value: number): void {
    preferencesPutInt(key, value);
  }

  getInt(key: string, defaultValue: number = 0): number {
    return preferencesGetInt(key, defaultValue);
  }

  putUInt(key: string, value: number): void {
    preferencesPutUInt(key, value);
  }

  getUInt(key: string, defaultValue: number = 0): number {
    return preferencesGetUInt(key, defaultValue);
  }

  putBool(key: string, value: boolean): void {
    preferencesPutBool(key, value);
  }

  getBool(key: string, defaultValue: boolean = false): boolean {
    return preferencesGetBool(key, defaultValue);
  }

  putFloat(key: string, value: number): void {
    preferencesPutFloat(key, value);
  }

  getFloat(key: string, defaultValue: number = 0): number {
    return preferencesGetFloat(key, defaultValue);
  }

  putString(key: string, value: string): void {
    preferencesPutString(key, value);
  }

  getString(key: string, defaultValue: string = ""): string {
    return preferencesGetString(key, defaultValue);
  }
}

export const Preferences = new PreferencesClass();
