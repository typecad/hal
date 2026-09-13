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

/**
 * An I2C device at one bus address — register reads and writes plus raw
 * byte transfers. Get one from a bus (`I2C0.device(0x44)`) or construct
 * directly: `new I2CTarget('I2C0', 0x44)`.
 */
export class I2CTarget {
  private readonly _bus: string;
  private readonly _address: number;
  private readonly _hz: number;

  /** Construct a device handle. `address` is the 7-bit I2C address (the
   *  number the datasheet prints, not the shifted read/write form); `hz`
   *  optionally sets the bus speed once at first use (e.g. 400_000 for
   *  fast mode) — the bus is left at its default speed when omitted. */
  constructor(bus: string, address: number, opts?: { hz?: number }) {
    this._bus = bus;
    this._address = address;
    this._hz = opts?.hz ?? 0;
  }

  /** Write one byte to register `reg`. */
  writeReg(reg: number, value: number): void {
    i2cRegWrite(this._bus, this._address, this._hz, reg, value);
  }

  /** Read one byte from register `reg`. */
  readReg(reg: number): number {
    return i2cRegRead(this._bus, this._address, this._hz, reg);
  }

  /** Update one register field: the bits selected by `mask` are replaced
   *  by `value` (in its low bits). Performed as a single bus transaction —
   *  no window where another reader sees a half-updated register. */
  updateReg(reg: number, mask: number, value: number): void {
    i2cRegUpdate(this._bus, this._address, this._hz, reg, mask, value);
  }

  /** Write raw bytes — for devices whose protocol isn't register-based. */
  write(data: number[] | Uint8Array): void {
    i2cDevWrite(this._bus, this._address, this._hz, data);
  }

  /** The 7-bit I2C address this target talks to — exposed so the same
   *  code can accept a real device or a simulated one
   *  (@typecad/hal/sim). */
  get address(): number {
    return this._address;
  }
}
