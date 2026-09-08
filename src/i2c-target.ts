// ---------------------------------------------------------------------------
// I2CTarget — the thin Zephyr-shaped I2C device
//
// One address on a bus, Zephyr's register verbs verbatim: writeReg/readReg
// are i2c_reg_write_byte / i2c_reg_read_byte, updateReg is the native
// read-modify-write (i2c_reg_update_byte — mask and all, no read-back race),
// and write() is i2c_write. No begin/end transaction dance, no Wire
// vocabulary — the controller device handle and the per-call address are all
// Zephyr needs.
//
// `bus` is the board's bus instance export (I2C0/I2C1); the address is the
// 7-bit form (0x44). The optional bus `hz` applies once (i2c_configure,
// guarded) — Zephyr's own I2C_SPEED_SET mapping.
// ----------------------------------------------------------------------------

import { i2cRegWrite, i2cRegRead, i2cRegUpdate, i2cDevWrite } from './emit.js';

export class I2CTarget {
  private readonly _bus: string;
  private readonly _address: number;
  private readonly _hz: number;

  /** Construct a device handle. `bus` is the bus instance (I2C0, I2C1, …);
   *  `address` is the 7-bit I2C address; `hz` optionally sets the bus speed
   *  once at first use (100k/400k/1M map to Zephyr's I2C_SPEED_* tiers). */
  constructor(bus: string, address: number, opts?: { hz?: number }) {
    this._bus = bus;
    this._address = address;
    this._hz = opts?.hz ?? 0;
  }

  /** Write one register byte (i2c_reg_write_byte). */
  writeReg(reg: number, value: number): void {
    i2cRegWrite(this._bus, this._address, this._hz, reg, value);
  }

  /** Read one register byte (i2c_reg_read_byte). */
  readReg(reg: number): number {
    return i2cRegRead(this._bus, this._address, this._hz, reg);
  }

  /** Read-modify-write one register field (i2c_reg_update_byte): the bits in
   *  `mask` are replaced by `value`. Atomic on the wire — no read-back race. */
  updateReg(reg: number, mask: number, value: number): void {
    i2cRegUpdate(this._bus, this._address, this._hz, reg, mask, value);
  }

  /** Write raw bytes (i2c_write) — commands and data with no register
   *  convention. */
  write(data: number[] | Uint8Array): void {
    i2cDevWrite(this._bus, this._address, this._hz, data);
  }

  /** The 7-bit I2C address this target addresses. Exposed so I2CTarget
   *  structurally satisfies the II2CDeviceAccessor contract (@typecad/hal/sim)
   *  contract (`readonly address`), letting the same driver function be
   *  typed against the contract and accept either a real board device or a
   *  simulated one. The transpiler strips HAL class bodies to IR, so this
   *  getter carries no runtime cost in the generated C++. */
  get address(): number {
    return this._address;
  }
}
