import { rawCpp } from './emit.js';
import { LSBFIRST, MSBFIRST } from './constants.js';
import type { Pin, OutputPin, InputPin } from './gpio.js';

export declare function shiftIn(dataPin: number, clockPin: number, bitOrder: number): number;
export declare function shiftOut(dataPin: number, clockPin: number, bitOrder: number, value: number): void;

export class Shift {
  /** Directly shifts a byte out to a pin. */
  static out(dataPin: Pin | OutputPin, clockPin: Pin | OutputPin, order: 'lsb' | 'msb', value: number): void {
    const bitOrder = order === 'lsb' ? LSBFIRST : MSBFIRST;
    rawCpp(`shiftOut(${(dataPin as any)._pin}, ${(clockPin as any)._pin}, ${bitOrder}, ${value});`);
  }

  /** Directly shifts a byte in from a pin. */
  static in(dataPin: Pin | InputPin, clockPin: Pin | OutputPin, order: 'lsb' | 'msb'): number {
    const bitOrder = order === 'lsb' ? LSBFIRST : MSBFIRST;
    rawCpp(`return shiftIn(${(dataPin as any)._pin}, ${(clockPin as any)._pin}, ${bitOrder});`);
    return 0;
  }

  /** Fluent builder for shifting out. */
  static write(dataPin: Pin | OutputPin, value: number): ShiftOutBuilder {
    return new ShiftOutBuilder(dataPin, value);
  }

  /** Fluent builder for shifting in. */
  static read(dataPin: Pin | InputPin): ShiftInBuilder {
    return new ShiftInBuilder(dataPin);
  }
}

class ShiftOutBuilder {
  private _dataPin: number;
  private _value: number;
  private _clockPin: number | undefined;

  constructor(dataPin: Pin | OutputPin, value: number) {
    this._dataPin = (dataPin as any)._pin;
    this._value = value;
  }

  clock(clk: Pin | OutputPin): this {
    this._clockPin = (clk as any)._pin;
    return this;
  }

  msbFirst(): void {
    if (this._clockPin === undefined) throw new Error("Clock pin must be specified");
    rawCpp(`shiftOut(${this._dataPin}, ${this._clockPin}, MSBFIRST, ${this._value});`);
  }

  lsbFirst(): void {
    if (this._clockPin === undefined) throw new Error("Clock pin must be specified");
    rawCpp(`shiftOut(${this._dataPin}, ${this._clockPin}, LSBFIRST, ${this._value});`);
  }
}

class ShiftInBuilder {
  private _dataPin: number;
  private _clockPin: number | undefined;

  constructor(dataPin: Pin | InputPin) {
    this._dataPin = (dataPin as any)._pin;
  }

  clock(clk: Pin | OutputPin): this {
    this._clockPin = (clk as any)._pin;
    return this;
  }

  msbFirst(): number {
    if (this._clockPin === undefined) throw new Error("Clock pin must be specified");
    rawCpp(`return shiftIn(${this._dataPin}, ${this._clockPin}, MSBFIRST);`);
    return 0;
  }

  lsbFirst(): number {
    if (this._clockPin === undefined) throw new Error("Clock pin must be specified");
    rawCpp(`return shiftIn(${this._dataPin}, ${this._clockPin}, LSBFIRST);`);
    return 0;
  }
}
