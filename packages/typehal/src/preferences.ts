export class PreferencesClass {
  begin(name: string, readOnly: boolean = false): void {}
  end(): void {}
  clear(): void {}
  remove(key: string): void {}
  putInt(key: string, value: number): void {}
  getInt(key: string, defaultValue: number = 0): number { return 0; }
  putBool(key: string, value: boolean): void {}
  getBool(key: string, defaultValue: boolean = false): boolean { return false; }
  putString(key: string, value: string): void {}
  getString(key: string, defaultValue: string = ""): string { return ""; }
}

export const Preferences = new PreferencesClass();
