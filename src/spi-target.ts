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

/**
 * An SPI device behind a chip-select pin: `SPI0.device(CS_PIN, { hz:
 * 1_000_000, mode: 0 })`. Chip select is hardware-managed — it toggles
 * automatically around each transfer, so you never touch it as a GPIO.
 * `transceive` is the full-duplex workhorse; `write` sends only; `readReg`
 * reads one register byte.
 */
export class SPITarget {
  private readonly _bus: string;
  private readonly _cs: number;
  private readonly _hz: number;
  private readonly _mode: number;

  /** Construct a device handle. `cs` is the chip-select pin; `hz` the bus
   *  clock (default 1 MHz — conservative, raise it to the device's rated
   *  maximum); `mode` the SPI mode 0–3. */
  constructor(bus: string, cs: number | Pin, opts?: { hz?: number; mode?: 0 | 1 | 2 | 3 }) {
    this._bus = bus;
    this._cs = typeof cs === 'number' ? cs : cs.number;
    this._hz = opts?.hz ?? 1000000;
    this._mode = opts?.mode ?? 0;
  }

  /** Full-duplex transfer: `tx` bytes go out while incoming bytes are
   *  captured into `rx`. The buffer you pass is the buffer filled — declare
   *  it and read it directly (`rx.length` decides how many bytes are
   *  captured). Omit `rx` for a write-only transfer. */
  transceive(tx: number[] | Uint8Array, rx?: Uint8Array): void {
    spiTransceiveDt(this._bus, this._cs, this._hz, this._mode, tx, rx ?? new Uint8Array(0));
  }

  /** Write bytes — nothing captured. */
  write(tx: number[] | Uint8Array): void {
    spiWriteDt(this._bus, this._cs, this._hz, this._mode, tx);
  }

  /** Register-read convenience: sends `reg`, returns the one reply byte
   *  (e.g. a BME280 answers 0x60 for ID register 0xD0). */
  readReg(reg: number): number {
    return spiReadReg(this._bus, this._cs, this._hz, this._mode, reg);
  }
}
