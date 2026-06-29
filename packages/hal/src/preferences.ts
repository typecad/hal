import { rawCpp } from './emit.js';

export class PreferencesClass {
  static readonly __instance_name = "Preferences";

  begin(name: string, readOnly: boolean = false): void {
    rawCpp(`Preferences.begin(${name}, ${readOnly});`);
  }
  end(): void {
    rawCpp(`Preferences.end();`);
  }
  clear(): void {
    rawCpp(`Preferences.clear();`);
  }
  remove(key: string): void {
    rawCpp(`Preferences.remove(${key});`);
  }
  putInt(key: string, value: number): void {
    rawCpp(`Preferences.putInt(${key}, ${value});`);
  }
  getInt(key: string, defaultValue: number = 0): number {
    rawCpp(`return Preferences.getInt(${key}, ${defaultValue});`);
    return 0;
  }
  putBool(key: string, value: boolean): void {
    rawCpp(`Preferences.putBool(${key}, ${value});`);
  }
  getBool(key: string, defaultValue: boolean = false): boolean {
    rawCpp(`return Preferences.getBool(${key}, ${defaultValue});`);
    return false;
  }
  putString(key: string, value: string): void {
    rawCpp(`Preferences.putString(${key}, ${value});`);
  }
  getString(key: string, defaultValue: string = ""): string {
    rawCpp(`return Preferences.getString(${key}, ${defaultValue});`);
    return "";
  }
}

export const Preferences = new PreferencesClass();
