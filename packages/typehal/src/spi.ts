import { emit } from './emit';

export class SPIBus {
  private _bus: string;

  constructor(bus: string) {
    this._bus = bus;
  }

  begin(): void {
    emit(`${this._bus}.begin();`);
  }

  end(): void {
    emit(`${this._bus}.end();`);
  }

  transfer(value: number): number {
    return 0;
  }

  setFrequency(hz: number): void {
    emit(`${this._bus}.beginTransaction(SPISettings(${hz}, MSBFIRST, SPI_MODE0));`);
  }

  endTransaction(): void {
    emit(`${this._bus}.endTransaction();`);
  }
}

/** Map TypeHAL SPI instance number to Arduino C++ object name. SPI0→SPI, SPI1→SPI1 */
export function spiName(instance: number): string {
  return instance === 0 ? "SPI" : `SPI${instance}`;
}
