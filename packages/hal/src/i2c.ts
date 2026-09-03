// ---------------------------------------------------------------------------
// I2C — controller selector (legacy Wire API removed)
//
// The bus singletons (I2C0/I2C1…) are CONTROLLER SELECTORS; device(address)
// hands back the FUNCTIONAL I2CTarget directly — register verbs callable with
// no further construction (`I2C0.device(0x44).writeReg(...)`) and the same
// fact-carrier `new Sensor(SENSOR.x, I2C0.device(0x44))` consumes. Explicit
// construction `new I2CTarget(I2C0, 0x44)` is equivalent. The former
// begin/endTransmission/requestFrom Wire reconstruction was removed with the
// legacy Arduino surface; the standalone I2CDevice fact-carrier was absorbed
// by I2CTarget (same facts, plus the verbs).
// ----------------------------------------------------------------------------

import { I2CTarget } from './i2c-target.js';

export class I2CBus {
  private _bus: string;

  constructor(bus: string) {
    this._bus = bus;
  }

  /** The functional device target at `address` on this controller —
   *  register verbs callable directly, and the fact-carrier `new Sensor(...)`
   *  accepts. Equivalent to `new I2CTarget(this, address)`. */
  device(address: number): I2CTarget {
    return new I2CTarget(this._bus, address);
  }
}
