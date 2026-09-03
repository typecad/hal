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

export class SPIBus {
  private _bus: string;

  constructor(bus: string) {
    this._bus = bus;
  }

  /** The functional device target behind `chipSelect` on this controller —
   *  transceive/write/regRead verbs callable directly, and the fact-carrier
   *  `new Sensor(...)` accepts. */
  device(chipSelect: Pin, opts?: { hz?: number; mode?: 0 | 1 | 2 | 3 }): SPITarget {
    return new SPITarget(this._bus, chipSelect, opts);
  }
}
