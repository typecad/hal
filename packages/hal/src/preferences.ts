import { emit } from './emit';

export class PreferencesClass {
  static readonly __instance_name = "Preferences";

  begin(name: string, readOnly: boolean = false): void {
    emit(`Preferences.begin(${name}, ${readOnly});`);
  }
  end(): void {
    emit(`Preferences.end();`);
  }
  clear(): void {
    emit(`Preferences.clear();`);
  }
  remove(key: string): void {
    emit(`Preferences.remove(${key});`);
  }
  putInt(key: string, value: number): void {
    emit(`Preferences.putInt(${key}, ${value});`);
  }
  getInt(key: string, defaultValue: number = 0): number {
    emit(`return Preferences.getInt(${key}, ${defaultValue});`);
    return 0;
  }
  putBool(key: string, value: boolean): void {
    emit(`Preferences.putBool(${key}, ${value});`);
  }
  getBool(key: string, defaultValue: boolean = false): boolean {
    emit(`return Preferences.getBool(${key}, ${defaultValue});`);
    return false;
  }
  putString(key: string, value: string): void {
    emit(`Preferences.putString(${key}, ${value});`);
  }
  getString(key: string, defaultValue: string = ""): string {
    emit(`return Preferences.getString(${key}, ${defaultValue});`);
    return "";
  }
}

export const Preferences = new PreferencesClass();
