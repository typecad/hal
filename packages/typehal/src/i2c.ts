import { emit } from './emit';
import { include } from './include';

export class I2CDevice {
  private _bus: string;
  private _address: number;

  constructor(bus: string, address: number) {
    this._bus = bus;
    this._address = address;
  }

  writeByte(register: number, value: number): void {
    emit(`${this._bus}.beginTransmission(${this._address});`);
    emit(`${this._bus}.write(${register});`);
    emit(`${this._bus}.write(${value});`);
    emit(`${this._bus}.endTransmission();`);
  }

  readByte(register: number): number {
    emit(`${this._bus}.beginTransmission(${this._address});`);
    emit(`${this._bus}.write(${register});`);
    emit(`${this._bus}.endTransmission(false);`);
    emit(`${this._bus}.requestFrom(${this._address}, 1);`);
    emit(`return ${this._bus}.read();`);
    return 0;
  }

  writeBytes(register: number, data: number[] | Uint8Array): void {
    emit(`${this._bus}.beginTransmission(${this._address});`);
    emit(`${this._bus}.write(${register});`);
    emit(`${this._bus}.write(${data}, sizeof(${data}));`);
    emit(`${this._bus}.endTransmission();`);
  }

  readBytes(register: number, count: number): Uint8Array {
    return new Uint8Array(count);
  }
}

export class I2CBus {
  private _bus: string;

  constructor(bus: string) {
    this._bus = bus;
  }

  device(address: number): I2CDevice {
    return new I2CDevice(this._bus, address);
  }

  begin(): this {
    include("<Wire.h>");
    emit(`${this._bus}.begin();`);
    return this;
  }

  beginSlave(address: number): void {
    emit(`${this._bus}.begin(${address});`);
  }

  end(): void {
    emit(`${this._bus}.end();`);
  }

  setClock(hz: number): void {
    emit(`${this._bus}.setClock(${hz});`);
  }

  writeByte(address: number, register: number, value: number): void {
    emit(`${this._bus}.beginTransmission(${address});`);
    emit(`${this._bus}.write(${register});`);
    emit(`${this._bus}.write(${value});`);
    emit(`${this._bus}.endTransmission();`);
  }

  readByte(address: number, register: number): number {
    return 0;
  }

  // Low-level Wire API pass-through methods
  beginTransmission(address: number): void {
    emit(`${this._bus}.beginTransmission(${address});`);
  }

  write(data: number | number[] | Uint8Array): void {
    emit(`${this._bus}.write(${data});`);
  }

  endTransmission(stop?: boolean): number {
    return 0;
  }

  requestFrom(address: number, quantity: number, stop?: boolean): number {
    return 0;
  }

  available(): number {
    return 0;
  }

  read(): number {
    return 0;
  }
}

/** Map TypeHAL I2C instance number to Arduino C++ object name. I2C0→Wire, I2C1→Wire1 */
export function i2cName(instance: number): string {
  return instance === 0 ? "Wire" : `Wire${instance}`;
}
