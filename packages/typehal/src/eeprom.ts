import { emit } from './emit';
import { include } from './include';

export class EEPROMClass {
  private _name: string;
  constructor(name: string) {
    include("<EEPROM.h>");
    this._name = name;
  }

  read(address: number): number { return 0; }
  write(address: number, value: number): void { emit(`${this._name}.write(${address}, ${value});`); }
  update(address: number, value: number): void { emit(`${this._name}.update(${address}, ${value});`); }
  length(): number { return 0; }
  get<T>(address: number, ref: T): T { return ref; }
  put<T>(address: number, value: T): void { emit(`${this._name}.put(${address}, ${value});`); }
}

export const EEPROM = new EEPROMClass("EEPROM");
