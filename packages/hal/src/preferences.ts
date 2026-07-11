import { rawCpp } from './emit.js';

export class PreferencesClass {
  static readonly __instance_name = "Preferences";
  // NOTE: no __includes here. The transpiler emits singleton __includes on
  // every architecture with no filtering, and <Preferences.h> is ESP32-only —
  // adding it would break AVR builds. The class is ESP32-only by convention.

  begin(name: string, readOnly: boolean = false): void {
    rawCpp(`Preferences.begin(${name}.c_str(), ${readOnly});`);
  }
  end(): void {
    rawCpp(`Preferences.end();`);
  }
  clear(): void {
    rawCpp(`Preferences.clear();`);
  }
  remove(key: string): void {
    rawCpp(`Preferences.remove(${key}.c_str());`);
  }
  putInt(key: string, value: number): void {
    rawCpp(`Preferences.putInt(${key}.c_str(), ${value});`);
  }
  getInt(key: string, defaultValue: number = 0): number {
    rawCpp(`return Preferences.getInt(${key}.c_str(), ${defaultValue});`);
    return 0;
  }
  putUInt(key: string, value: number): void {
    rawCpp(`Preferences.putUInt(${key}.c_str(), ${value});`);
  }
  getUInt(key: string, defaultValue: number = 0): number {
    rawCpp(`return Preferences.getUInt(${key}.c_str(), ${defaultValue});`);
    return 0;
  }
  putFloat(key: string, value: number): void {
    rawCpp(`Preferences.putFloat(${key}.c_str(), ${value});`);
  }
  getFloat(key: string, defaultValue: number = 0): number {
    rawCpp(`return Preferences.getFloat(${key}.c_str(), ${defaultValue});`);
    return 0;
  }
  putBool(key: string, value: boolean): void {
    rawCpp(`Preferences.putBool(${key}.c_str(), ${value});`);
  }
  getBool(key: string, defaultValue: boolean = false): boolean {
    rawCpp(`return Preferences.getBool(${key}.c_str(), ${defaultValue});`);
    return false;
  }
  putString(key: string, value: string): void {
    rawCpp(`Preferences.putString(${key}.c_str(), ${value}.c_str());`);
  }
  getString(key: string, defaultValue: string = ""): string {
    rawCpp(`return Preferences.getString(${key}.c_str(), ${defaultValue}.c_str());`);
    return "";
  }
}

export const Preferences = new PreferencesClass();
