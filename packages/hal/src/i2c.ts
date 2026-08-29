// ---------------------------------------------------------------------------
// I2C — controller identity + device-fact carriers (legacy Wire API removed)
//
// The bus singletons (I2C0/I2C1…) are CONTROLLER SELECTORS; the only method
// they keep is device(address), producing the fact-carrier the generic Sensor
// catalog consumes (`new Sensor(SENSOR.x, I2C1.device(0x44))`). Register-level
// access to arbitrary devices is the thin `I2CTarget` (i2c-target.ts):
// writeReg/readReg/updateReg/write — Zephyr's i2c_reg_*_byte verbs, no
// transaction dance. The former begin/endTransmission/requestFrom Wire
// reconstruction was removed with the legacy Arduino surface.
//
// The `address` getter keeps @typecad/simulator's II2CDeviceAccessor contract
// satisfied (structural typing for host-side simulation).
// ----------------------------------------------------------------------------

export class I2CDevice {
  private _bus: string;
  private _address: number;

  constructor(bus: string, address: number) {
    this._bus = bus;
    this._address = address;
  }

  /** The 7-bit I2C address this accessor targets. Exposed so I2CDevice
   *  structurally satisfies the @typecad/simulator II2CDeviceAccessor contract
   *  (which declares `readonly address`), letting the same driver function be
   *  typed against the contract and accept either a real board device or a
   *  simulated one. The transpiler strips HAL class bodies to IR, so this
   *  getter carries no runtime cost in the generated C++. */
  get address(): number {
    return this._address;
  }
}

export class I2CBus {
  private _bus: string;

  constructor(bus: string) {
    this._bus = bus;
  }

  /** Produce the fact-carrier for one device address on this controller.
   *  Pass it to `new Sensor(...)`; use `I2CTarget` directly instead when you
   *  need register verbs. */
  device(address: number): I2CDevice {
    return new I2CDevice(this._bus, address);
  }
}
