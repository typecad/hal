import { spiBegin, spiEnd, spiTransfer, spiBeginTx, spiEndTx, spiCsLow, spiCsHigh, spiSetMode, spiSetBitOrder, rawCpp } from './emit';
import { include } from './include';
import type { Pin } from './gpio';

export class SPIDevice {
  private _bus: string;
  private _cs: number;

  constructor(bus: string, chipSelect: number) {
    this._bus = bus;
    this._cs = chipSelect;
  }

  transfer(data: number | Uint8Array): number {
    rawCpp(`digitalWrite(${this._cs}, LOW);`);
    rawCpp(`auto __res = ${this._bus}.transfer(${data});`);
    rawCpp(`digitalWrite(${this._cs}, HIGH);`);
    rawCpp(`return __res;`);
    return 0;
  }

  write(data: number | Uint8Array): void {
    spiCsLow(this._cs);
    spiTransfer(this._bus, data);
    spiCsHigh(this._cs);
  }

  readRegister(register: number, count: number): Uint8Array {
    rawCpp(`digitalWrite(${this._cs}, LOW);`);
    rawCpp(`${this._bus}.transfer(${register});`);
    rawCpp(`uint8_t result[${count}];`);
    rawCpp(`for (int i=0; i<${count}; i++) result[i] = ${this._bus}.transfer(0x00);`);
    rawCpp(`digitalWrite(${this._cs}, HIGH);`);
    rawCpp(`return result;`);
    return new Uint8Array(count);
  }

  writeRegister(register: number, value: number): void {
    spiCsLow(this._cs);
    spiTransfer(this._bus, register);
    spiTransfer(this._bus, value);
    spiCsHigh(this._cs);
  }
}

export class SPIBus {
  private _bus: string;

  constructor(bus: string) {
    this._bus = bus;
  }

  device(chipSelect: Pin): SPIDevice {
    return new SPIDevice(this._bus, chipSelect.number);
  }

  begin(): this {
    include("<SPI.h>");
    spiBegin(this._bus);
    return this;
  }

  end(): void {
    spiEnd(this._bus);
  }

  take(): this | null {
    return this;
  }

  release(): void {
    // No-op for standard Arduino.
  }


  transfer(value: number | Uint8Array): number {
    return spiTransfer(this._bus, value);
  }

  setFrequency(hz: number): void {
    spiBeginTx(this._bus, `SPISettings(${hz}, MSBFIRST, SPI_MODE0)`);
  }

  beginTransaction(settings: any): void {
    spiBeginTx(this._bus, settings);
  }

  endTransaction(): void {
    spiEndTx(this._bus);
  }

  setMode(mode: number): void {
    spiSetMode(this._bus, mode);
  }

  setBitOrder(order: 'lsb' | 'msb'): void {
    spiSetBitOrder(this._bus, order);
  }

  write(value: number): void {
    spiTransfer(this._bus, value);
  }

  write16(value: number): void {
    rawCpp(`${this._bus}.transfer16(${value});`);
  }
}

/** Map TypeHAL SPI instance number to Arduino C++ object name. SPI0→SPI, SPI1→SPI1 */
export function spiName(instance: number): string {
  return instance === 0 ? "SPI" : `SPI${instance}`;
}
