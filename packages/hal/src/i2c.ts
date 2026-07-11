import { i2cBegin, i2cEnd, i2cSetClock, i2cBeginTx, i2cWrite, i2cWriteBuffer, i2cEndTx, i2cRequestFrom, i2cAvailable, i2cRead, rawCpp } from './emit.js';
import { include } from './include.js';

export class I2CDevice {
  private _bus: string;
  private _address: number;

  constructor(bus: string, address: number) {
    this._bus = bus;
    this._address = address;
  }

  writeByte(register: number, value: number): void {
    include("<Wire.h>");
    i2cBeginTx(this._bus, this._address);
    i2cWrite(this._bus, register);
    i2cWrite(this._bus, value);
    i2cEndTx(this._bus, true);
  }

  readByte(register: number): number {
    include("<Wire.h>");
    i2cBeginTx(this._bus, this._address);
    i2cWrite(this._bus, register);
    i2cEndTx(this._bus, false);
    i2cRequestFrom(this._bus, this._address, 1);
    return i2cRead(this._bus);
  }

  writeBytes(register: number, data: number[] | Uint8Array): void {
    include("<Wire.h>");
    i2cBeginTx(this._bus, this._address);
    i2cWrite(this._bus, register);
    i2cWriteBuffer(this._bus, data);
    i2cEndTx(this._bus, true);
  }

  readBytes(register: number, count: number): Uint8Array {
    include("<Wire.h>");
    i2cBeginTx(this._bus, this._address);
    i2cWrite(this._bus, register);
    i2cEndTx(this._bus, false);
    i2cRequestFrom(this._bus, this._address, count, true);
    rawCpp(`static uint8_t __buf[${count}];`);
    rawCpp(`for (int __i = 0; __i < ${count}; __i++) __buf[__i] = ${this._bus}.read();`);
    rawCpp(`return __buf;`);
    return new Uint8Array(count);
  }
}

export class I2CBus {
  static readonly __includes = ["<Wire.h>"];
  private _bus: string;

  constructor(bus: string) {
    this._bus = bus;
  }

  device(address: number): I2CDevice {
    return new I2CDevice(this._bus, address);
  }

  begin(): this {
    include("<Wire.h>");
    i2cBegin(this._bus);
    return this;
  }

  beginSlave(address: number): void {
    i2cBegin(this._bus, address);
  }

  end(): void {
    i2cEnd(this._bus);
  }

  setClock(hz: number): void {
    i2cSetClock(this._bus, hz);
  }

  /** Recover a locked I2C bus by clocking SCL until the stuck slave releases SDA.
   *
   *  NOTE: This references the board-defined `SCL` pin macro. All current MCU
   *  packages (atmega328p, esp32, esp32c3, esp32c6, esp32s3) export SCL, so
   *  this works in practice. A fully portable version would resolve the SCL
   *  pin number via a board constant (e.g. peripherals.i2c.0.sclPin), but that
   *  requires adding resolved numeric pin fields to the board-constants
   *  pipeline — deferred for now. */
  recover(): void {
    include("<Wire.h>");
    rawCpp(`pinMode(SCL, OUTPUT);`);
    rawCpp(`for (int i = 0; i < 16; i++) {`);
    rawCpp(`  digitalWrite(SCL, LOW);`);
    rawCpp(`  delayMicroseconds(10);`);
    rawCpp(`  digitalWrite(SCL, HIGH);`);
    rawCpp(`  delayMicroseconds(10);`);
    rawCpp(`}`);
    rawCpp(`${this._bus}.begin();`);
  }

  take(): this | null {
    include("<Wire.h>");
    return this;
  }

  release(): void {
    // No-op for standard Arduino.
  }

  writeByte(address: number, register: number, value: number): void {
    i2cBeginTx(this._bus, address);
    i2cWrite(this._bus, register);
    i2cWrite(this._bus, value);
    i2cEndTx(this._bus, true);
  }

  readByte(address: number, register: number): number {
    i2cBeginTx(this._bus, address);
    i2cWrite(this._bus, register);
    i2cEndTx(this._bus, false);
    i2cRequestFrom(this._bus, address, 1);
    return i2cRead(this._bus);
  }

  // Low-level Wire API pass-through methods
  beginTransmission(address: number): void {
    i2cBeginTx(this._bus, address);
  }

  write(data: number | number[] | Uint8Array): void {
    i2cWrite(this._bus, data);
  }

  endTransmission(stop?: boolean): number {
    return i2cEndTx(this._bus, stop ?? true);
  }

  requestFrom(address: number, quantity: number, stop?: boolean): number {
    return i2cRequestFrom(this._bus, address, quantity, stop ?? true);
  }

  available(): number {
    return i2cAvailable(this._bus);
  }

  read(): number {
    return i2cRead(this._bus);
  }
}


/** Map TypeCAD I2C instance number to Arduino C++ object name. I2C0→Wire, I2C1→Wire1 */
export function i2cName(instance: number): string {
  return instance === 0 ? "Wire" : `Wire${instance}`;
}
