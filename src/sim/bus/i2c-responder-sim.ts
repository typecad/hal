// ---------------------------------------------------------------------------
// SimI2CResponder — @typecad/hal/sim model of the I2C responder
//
// The device-side surface is the hardware class verbatim (II2CResponder —
// driver code written against it runs unchanged); the test bench gets the
// CONTROLLER side too: masterWrite/masterRead drive transactions into the
// responder exactly as the Zephyr shim's i2c_target callbacks would see
// them, transaction-for-transaction:
//
//   write_requested  → the receive ring resets
//   write_received×N → bytes land in the ring (overflow-drop)
//   read_requested   → onRequest fires (the refill point), first byte served
//   read_processed×N → further bytes, 0xFF past the buffer's end
//   stop             → onReceive fires with the ring's byte count
//
// A combined write-then-read (the register-select form bus.device(addr)
// uses) is ONE transaction: the register byte lands in the ring but
// onReceive waits for the final STOP — the same combined-transaction
// semantics the hardware shim exhibits.
// ----------------------------------------------------------------------------

import type { II2CResponder } from '../contracts.js';
import type { SimI2CBus } from './i2c-sim.js';

/**
 * The board answering at one I2C address — the simulator's I2CResponder.
 * Construct through a bus (`i2c.responder(0x42)`, which also registers it
 * for loopback and operation logging) or standalone
 * (`new SimI2CResponder(0x42)`). The test bench is the controller:
 * `masterWrite(bytes)` delivers a controller write, `masterRead(count)`
 * performs a controller read.
 */
export class SimI2CResponder implements II2CResponder {
  readonly address: number;

  private readonly _rxBufferBytes: number;
  private readonly _txBufferBytes: number;
  private _rx: number[] = [];
  private _tx: number[] = [];
  private _onReceive: ((len: number) => void) | null = null;
  private _onRequest: (() => void) | null = null;
  /** Set when created through a bus — routes the operation log. */
  private _bus: SimI2CBus | null = null;

  /** Construct a responder. `rxBufferBytes` (default 64) sizes the receive
   *  ring — longer controller writes overflow-drop; `txBufferBytes`
   *  (default 32) the response buffer — an over-long write() throws, the
   *  simulator's honest stand-in for the build error the lowering raises. */
  constructor(address: number, opts?: { rxBufferBytes?: number; txBufferBytes?: number }) {
    this.address = address;
    this._rxBufferBytes = opts?.rxBufferBytes ?? 64;
    this._txBufferBytes = opts?.txBufferBytes ?? 32;
  }

  /** @internal Register with a bus (loopback routing + operation log). */
  _attach(bus: SimI2CBus): void {
    this._bus = bus;
  }

  /** Announce controller writes: fires when a write transaction completes,
   *  with the number of bytes now waiting in the receive buffer. */
  onReceive(handler: (len: number) => void): void {
    this._onReceive = handler;
  }

  /** Serve controller reads: fires as each read transaction begins — call
   *  `write()` inside it to load this transaction's response. */
  onRequest(handler: () => void): void {
    this._onRequest = handler;
  }

  /** Bytes waiting in the receive buffer. */
  available(): number {
    return this._rx.length;
  }

  /** Pop the oldest received byte; -1 when the buffer is empty. */
  read(): number {
    const b = this._rx.shift();
    return b === undefined ? -1 : b;
  }

  /** Load the response buffer — the bytes the next controller read
   *  receives, first byte first. The buffer persists across reads until
   *  overwritten. */
  write(data: number[] | Uint8Array): void {
    if (data.length > this._txBufferBytes) {
      throw new Error(
        `I2C responder write: the response buffer holds ${this._txBufferBytes} bytes — got ${data.length}. Construct with a larger txBufferBytes.`,
      );
    }
    this._tx = Array.from(data, (b) => b & 0xff);
  }

  // ── Controller side — the test bench drives these ─────────────────────
  //
  // One method per bus transaction; each models the full Zephyr callback
  // sequence including the STOP that announces a completed write.

  /** A controller write transaction: `bytes` land in the receive ring
   *  (longer writes overflow-drop), then `onReceive(len)` fires. */
  masterWrite(bytes: number[] | Uint8Array): void {
    this._writePhase(bytes);
    this._stopPhase();
    this._log('write', -1, Array.from(bytes, (b) => b & 0xff));
  }

  /** A controller read transaction: `onRequest` fires (the refill point),
   *  then `count` bytes are served from the response buffer — 0xFF past
   *  its end (the bus has no NACK for a too-long read). */
  masterRead(count: number): number[] {
    const out = this._readPhase(count);
    this._stopPhase();
    this._log('read', -1, out);
    return out;
  }

  /** @internal One register-write transaction — the loopback device() path:
   *  the register byte leads the payload, exactly as a controller sends it. */
  _transactionWrite(register: number, data: number[]): void {
    this._writePhase([register & 0xff, ...data]);
    this._stopPhase();
    this._log('write', register, data);
  }

  /** @internal One combined register-select transaction — the loopback
   *  device() path: the register byte lands in the ring (no STOP), the
   *  read serves the response, the final STOP announces both. */
  _transactionRead(register: number, count: number): number[] {
    this._writePhase([register & 0xff]);
    const out = this._readPhase(count);
    this._stopPhase();
    this._log('read', register, out);
    return out;
  }

  /** Clear the buffers and handlers (construction facts stay). */
  reset(): void {
    this._rx = [];
    this._tx = [];
    this._onReceive = null;
    this._onRequest = null;
  }

  // ── Transaction phases (the i2c_target callback groups) ───────────────

  /** write_requested + write_received×N: the ring resets, bytes land. No
   *  STOP yet — a following read phase continues the same transaction. */
  private _writePhase(bytes: number[] | Uint8Array): void {
    this._rx = [];
    for (const b of bytes) {
      if (this._rx.length < this._rxBufferBytes) {
        this._rx.push(b & 0xff);
      }
    }
  }

  /** read_requested + read_processed×N: the refill point fires, then bytes
   *  serve first-byte-first. The response buffer persists (hardware keeps
   *  it until the next write()). */
  private _readPhase(count: number): number[] {
    if (this._onRequest !== null) this._onRequest();
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      out.push(i < this._tx.length ? this._tx[i]! : 0xff);
    }
    return out;
  }

  /** stop: a completed controller write announces the waiting count. After
   *  a combined register-select transaction the pending register byte
   *  announces here too — the hardware shim behaves identically. */
  private _stopPhase(): void {
    if (this._onReceive !== null && this._rx.length > 0) {
      this._onReceive(this._rx.length);
    }
  }

  private _log(operation: 'read' | 'write', register: number, data: number[]): void {
    if (this._bus !== null) {
      this._bus._logOperation({ operation, address: this.address, register, data, timestamp: Date.now() });
    }
  }
}
