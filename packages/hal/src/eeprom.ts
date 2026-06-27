import { rawCpp } from './emit.js';
import { include } from './include.js';

export class EEPROMClass {
  static readonly __instance_name = "EEPROM";
  static readonly __includes = ["<EEPROM.h>"];
  static readonly __default_fields = { _name: "EEPROM" };

  private _name: string;
  constructor(name: string) {
    include("<EEPROM.h>");
    this._name = name;
  }

  read(address: number): number { return 0; }
  write(address: number, value: number): void { rawCpp(`${this._name}.write(${address}, ${value});`); }
  update(address: number, value: number): void { rawCpp(`${this._name}.update(${address}, ${value});`); }
  length(): number { return 0; }
  get<T>(address: number, ref: T): T { return ref; }
  put<T>(address: number, value: T): void { rawCpp(`${this._name}.put(${address}, ${value});`); }
}

export const EEPROM = new EEPROMClass("EEPROM");
