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

/**
 * An I2C bus. Board modules export one instance per wired bus (`I2C0`,
 * `I2C1`…). Get a device with `I2C0.device(0x44)` and call its register
 * verbs directly, or hand it to a Sensor: `new Sensor(SENSOR.x,
 * I2C0.device(0x44))`.
 */
export class I2CBus {
  private _bus: string;

  constructor(bus: string) {
    this._bus = bus;
  }

  /** The device at 7-bit `address` on this bus — e.g.
   *  `I2C0.device(0x44).writeReg(0x30, 1)`. Also the form `new Sensor(...)`
   *  accepts. */
  device(address: number): I2CTarget {
    return new I2CTarget(this._bus, address);
  }
}
