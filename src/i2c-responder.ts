// ---------------------------------------------------------------------------
// I2CResponder — this board AS an I2C target (slave mode)
//
// The mirror of I2CTarget: there the board TALKS TO a device at an address;
// here the board ANSWERS at one. Zephyr's i2c_target API verbatim in shape:
// registration is i2c_target_register behind a once-guard, the five driver
// callbacks become two user-facing ones, and the byte flow is
// buffer-mediated — a controller write lands in the receive ring (the UART
// discipline: available()/read() poll it, onReceive(len) announces it at the
// transaction's STOP), and a controller read drains the response buffer the
// user fills with write() (onRequest fires as the read begins — the refill
// point, the Wire onRequest semantic).
//
// `bus` is the board's bus instance export (I2C0/I2C1); `address` is the
// 7-bit form (0x42). Both callbacks fire in the driver's interrupt context —
// the ISR discipline (set a variable, post to a queue; don't busy-work).
// ----------------------------------------------------------------------------

import {
  i2cRespOnReceive,
  i2cRespOnRequest,
  i2cRespAvailable,
  i2cRespRead,
  i2cRespWrite,
} from './emit.js';
import { callback } from './callback.js';

/**
 * This board answering as an I2C target: `I2C0.responder(0x42)` or
 * `new I2CResponder('I2C0', 0x42)`. A controller write lands in the receive
 * buffer — `onReceive(len)` announces it, then `available()`/`read()` drain
 * it. Serve controller reads by filling the response buffer with `write()`;
 * `onRequest()` fires as each read begins (the refill point). Registration
 * happens at the first call — install the callbacks early in setup so the
 * address answers from boot.
 */
export class I2CResponder {
  private readonly _bus: string;
  private readonly _address: number;
  private readonly _rxBufferBytes: number;
  private readonly _txBufferBytes: number;

  /** Construct a responder. `address` is the 7-bit I2C address the board
   *  answers at (the datasheet number, not the shifted read/write form);
   *  `rxBufferBytes` sizes the receive ring (default 64 — longer controller
   *  writes overflow-drop), `txBufferBytes` the response buffer (default
   *  32 — a write() longer than it is a build error). */
  constructor(bus: string, address: number, opts?: { rxBufferBytes?: number; txBufferBytes?: number }) {
    this._bus = bus;
    this._address = address;
    this._rxBufferBytes = opts?.rxBufferBytes ?? 64;
    this._txBufferBytes = opts?.txBufferBytes ?? 32;
  }

  /** Announce controller writes: fires when a write transaction completes,
   *  with the number of bytes now waiting in the receive buffer. Annotate
   *  the handler's parameter (`(len: number) => void`). Interrupt context. */
  onReceive(handler: (len: number) => void): void {
    i2cRespOnReceive(this._bus, this._address, this._rxBufferBytes, this._txBufferBytes, callback(handler));
  }

  /** Serve controller reads: fires as each read transaction begins — call
   *  `write()` inside it to load this transaction's response. When no
   *  handler is installed, the response buffer keeps serving its last
   *  contents (0xFF once drained). Interrupt context. */
  onRequest(handler: () => void): void {
    i2cRespOnRequest(this._bus, this._address, this._rxBufferBytes, this._txBufferBytes, callback(handler));
  }

  /** Bytes waiting in the receive buffer. Receiving starts at the first
   *  responder call — call this early in setup if input can arrive right
   *  away. */
  available(): number {
    return i2cRespAvailable(this._bus, this._address, this._rxBufferBytes, this._txBufferBytes);
  }

  /** Pop the oldest received byte; -1 when the buffer is empty. */
  read(): number {
    return i2cRespRead(this._bus, this._address, this._rxBufferBytes, this._txBufferBytes);
  }

  /** Load the response buffer — the bytes the next controller read
   *  receives, first byte first. The buffer persists across reads until
   *  overwritten; past its end the controller reads 0xFF. */
  write(data: number[] | Uint8Array): void {
    i2cRespWrite(this._bus, this._address, this._rxBufferBytes, this._txBufferBytes, data);
  }
}
