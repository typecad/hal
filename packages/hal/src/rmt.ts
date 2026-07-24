// ---------------------------------------------------------------------------
// @typecad/hal — RMT (Remote Control Transceiver) ergonomic API
// ---------------------------------------------------------------------------
// Exposes RMT via a RmtChannel class, mirroring the I2CBus/I2CDevice pattern.
// The transpiler only resolves semantic calls made inside class-method bodies
// (free top-level calls emit verbatim), so every peripheral exposes its API
// through a class whose methods call the positional semantic primitives in
// emit.ts. The resolver collapses object literals, so HALOpIR fields must be
// scalars; these methods destructure `opts` at the call site before forwarding.
//
// Channel identity is the GPIO pin (like pwm.ts's LEDC channel-per-pin model).

import type { Pin } from './gpio.js';
import {
  rmtTxInit,
  rmtRxInit,
  rmtTxWriteBytes,
  rmtTxWriteSymbols,
  rmtTxWaitDone,
  rmtTxDeinit,
  rmtRxOnReceived,
  rmtRxStart,
  rmtRxStop,
  rmtRxRead,
  rmtRxDeinit,
} from './emit.js';

/** Pin identifier accepted by RmtChannel: a Pin object, raw GPIO number, or port name. */
type RmtPin = Pin | number | string;

/**
 * RMT transceiver channel bound to a GPIO pin. One channel per pin; TX and RX
 * are independent roles on the same channel object.
 *
 * ```ts
 * const led = new RmtChannel(LED);
 * led.txInit({ resolutionHz: 10_000_000, bit0: [4, 9], bit1: [9, 4] });
 * led.txWriteBytes([0, 16, 0]);
 * led.txWaitDone();
 * ```
 */
export class RmtChannel {
  private _pin: RmtPin;

  constructor(pin: RmtPin) {
    this._pin = pin;
  }

  // ── TX ─────────────────────────────────────────────────────────────────────
  /** Initialize the channel for TX. Idempotent per pin. Bit timings are fixed
   *  at init — ESP-IDF bakes them into the bytes-encoder and exposes no public
   *  mutation API. Tick units are 1/resolutionHz seconds.
   *
   *  Args are positional scalars (not an opts object) because the transpiler's
   *  method-body renderer folds scalar params but not property accesses on an
   *  object param (opts.resolutionHz would render as a collapsed object + dead
   *  property access). Mirrors how I2CBus.begin(address) takes a scalar. */
  txInit(
    resolutionHz: number,
    bit0Hi: number, bit0Lo: number,
    bit1Hi: number, bit1Lo: number,
    msbFirst: boolean = false,
    queueDepth: number = 4,
  ): void {
    rmtTxInit(
      this._pin,
      resolutionHz,
      bit0Hi, bit0Lo,
      bit1Hi, bit1Lo,
      msbFirst,
      queueDepth,
    );
  }

  /** Write bytes via the channel's bytes-encoder (timings fixed at txInit). */
  txWriteBytes(bytes: number[] | Uint8Array): void {
    rmtTxWriteBytes(this._pin, bytes);
  }

  /** Write raw RMT symbols — arbitrary [hiTicks, loTicks] pairs. */
  txWriteSymbols(symbols: [number, number][]): void {
    rmtTxWriteSymbols(this._pin, symbols);
  }

  /** Block until the queued TX completes. */
  txWaitDone(timeoutMs?: number): void {
    rmtTxWaitDone(this._pin, timeoutMs);
  }

  /** Tear down the TX channel and release its slot. */
  txDeinit(): void {
    rmtTxDeinit(this._pin);
  }

  // ── RX ─────────────────────────────────────────────────────────────────────
  /** Initialize the channel for RX. Idempotent per pin. */
  rxInit(resolutionHz: number): void {
    rmtRxInit(this._pin, resolutionHz);
  }

  /** Register a callback-by-name invoked when an RX burst completes. */
  rxOnReceived(handler: string): void {
    rmtRxOnReceived(this._pin, handler);
  }

  /** Start receiving. */
  rxStart(): void {
    rmtRxStart(this._pin);
  }

  /** Stop receiving. */
  rxStop(): void {
    rmtRxStop(this._pin);
  }

  /** Blocking read — returns flattened symbols [d0,l0,d1,l1,…] in ticks. */
  rxRead(maxCount: number): number[] {
    return rmtRxRead(this._pin, maxCount);
  }

  /** Tear down the RX channel and release its slot. */
  rxDeinit(): void {
    rmtRxDeinit(this._pin);
  }
}
