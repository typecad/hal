// ---------------------------------------------------------------------------
// SPITarget — the thin Zephyr-shaped SPI device
//
// A chip-select peer on an SPI bus, addressed the Zephyr way: construction
// emits a devicetree child node (cs-gpios index + spi-max-frequency + mode
// bits — the same machinery sensors ride), and the verbs lower to
// spi_transceive_dt / spi_write_dt against a static spi_dt_spec. Hardware
// CS, no manual GPIO toggling, no runtime spi_config rebuilding.
//
// `bus` is the board's bus instance export (SPI0/SPI1), `cs` the chip-select
// pin, and the options are the wire facts: `hz` (spi-max-frequency) and
// `mode` (CPOL/CPHA bits 0–3 → spi-cpol/spi-cpha).
// ----------------------------------------------------------------------------

import { spiTransceiveDt, spiWriteDt, spiReadReg } from './emit.js';
import type { Pin } from './gpio.js';

export class SPITarget {
  private readonly _bus: string;
  private readonly _cs: number;
  private readonly _hz: number;
  private readonly _mode: number;

  /** Construct a device handle. `bus` is the bus instance (SPI0, …); `cs`
   *  is the chip-select pin; `hz` the bus clock (spi-max-frequency, default
   *  1 MHz conservative); `mode` the SPI mode 0–3. */
  constructor(bus: string, cs: number | Pin, opts?: { hz?: number; mode?: 0 | 1 | 2 | 3 }) {
    this._bus = bus;
    this._cs = typeof cs === 'number' ? cs : cs.number;
    this._hz = opts?.hz ?? 1000000;
    this._mode = opts?.mode ?? 0;
  }

  /** Full-duplex transfer (spi_transceive_dt): `tx` bytes out while `rx`
   *  captures — the buffer you pass is the buffer filled, so declare it and
   *  read it directly (rx.length decides the capture length). Omit `rx`
   *  for a write-only transfer. */
  transceive(tx: number[] | Uint8Array, rx?: Uint8Array): void {
    spiTransceiveDt(this._bus, this._cs, this._hz, this._mode, tx, rx ?? new Uint8Array(0));
  }

  /** Write bytes (spi_write_dt) — no capture. */
  write(tx: number[] | Uint8Array): void {
    spiWriteDt(this._bus, this._cs, this._hz, this._mode, tx);
  }

  /** Register read sugar: sends `reg`, returns the one captured byte
   *  (spi_transceive_dt against an internal buffer — e.g. a BME280's ID
   *  register 0xD0 reads 0x60). */
  readReg(reg: number): number {
    return spiReadReg(this._bus, this._cs, this._hz, this._mode, reg);
  }
}
