import { emit } from './emit';
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
    emit(`digitalWrite(${this._cs}, LOW);`);
    emit(`${this._bus}.transfer(${data});`);
    emit(`digitalWrite(${this._cs}, HIGH);`);
    return 0;
  }

  write(data: number | Uint8Array): void {
    emit(`digitalWrite(${this._cs}, LOW);`);
    emit(`${this._bus}.transfer(${data});`);
    emit(`digitalWrite(${this._cs}, HIGH);`);
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
    emit(`${this._bus}.begin();`);
    return this;
  }

  end(): void {
    emit(`${this._bus}.end();`);
  }

  transfer(value: number | Uint8Array): number {
    return 0;
  }

  setFrequency(hz: number): void {
    emit(`${this._bus}.beginTransaction(SPISettings(${hz}, MSBFIRST, SPI_MODE0));`);
  }

  beginTransaction(settings: any): void {
    emit(`${this._bus}.beginTransaction(${settings});`);
  }

  endTransaction(): void {
    emit(`${this._bus}.endTransaction();`);
  }

  setMode(mode: number): void {
    emit(`${this._bus}.setDataMode(${mode});`);
  }

  setBitOrder(order: 'lsb' | 'msb'): void {
    emit(`${this._bus}.setBitOrder(${order});`);
  }

  write(value: number): void {
    emit(`${this._bus}.transfer(${value});`);
  }

  write16(value: number): void {
    emit(`${this._bus}.transfer16(${value});`);
  }
}

/** Map TypeHAL SPI instance number to Arduino C++ object name. SPI0→SPI, SPI1→SPI1 */
export function spiName(instance: number): string {
  return instance === 0 ? "SPI" : `SPI${instance}`;
}
