import { emit } from './emit';

export class I2CBus {
  private _bus: string;

  constructor(bus: string) {
    this._bus = bus;
  }

  begin(): void {
    emit(`${this._bus}.begin();`);
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
}

/** Map TypeHAL I2C instance number to Arduino C++ object name. I2C0→Wire, I2C1→Wire1 */
export function i2cName(instance: number): string {
  return instance === 0 ? "Wire" : `Wire${instance}`;
}
