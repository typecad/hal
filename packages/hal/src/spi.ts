// ---------------------------------------------------------------------------
// SPI — controller selector (legacy SPI API removed)
//
// The bus singletons (SPI0/SPI1…) are CONTROLLER SELECTORS; device(cs, opts?)
// hands back the FUNCTIONAL SPITarget directly — transceive/write/regRead
// verbs callable with no further construction. Equivalent to
// `new SPITarget(this, cs, opts)`. The standalone SPIDevice fact-carrier was
// absorbed by SPITarget.
// ----------------------------------------------------------------------------

import { SPITarget } from './spi-target.js';
import type { Pin } from './gpio.js';

/**
 * An SPI bus. Board modules export one instance per wired bus (`SPI0`,
 * `SPI1`…). Get a device with `SPI0.device(CS_PIN, { hz: 1_000_000 })` and
 * call its transfer verbs directly, or hand it to a Sensor.
 */
export class SPIBus {
  private _bus: string;

  constructor(bus: string) {
    this._bus = bus;
  }

  /** The device behind the `chipSelect` pin on this bus — transfer verbs
   *  callable directly, and the form `new Sensor(...)` accepts. */
  device(chipSelect: Pin, opts?: { hz?: number; mode?: 0 | 1 | 2 | 3 }): SPITarget {
    return new SPITarget(this._bus, chipSelect, opts);
  }
}
