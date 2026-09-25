// ---------------------------------------------------------------------------
// CAN — the thin Zephyr-shaped CAN bus
//
// One controller per board (the harvested can@ node — ESP32 TWAI, STM32
// bxCAN, NXP FlexCAN…); the class addresses it by its devicetree nodelabel.
// The verbs mirror Zephyr's: begin() applies mode + bitrate + start (the
// classic CAN controller requires stopping for mode/bitrate changes — begin
// does it in the right order); send() builds one can_frame and submits it;
// onReceive() installs an accept-all filter whose callback carries the
// frame as scalars.
//
// LOOPBACK is the zero-hardware test mode: `begin({ loopback: true })` and
// every sent frame loops back to your own filter — no transceiver, no
// wiring, the honest bench verification of the whole path.
// ----------------------------------------------------------------------------

import { canBegin, canSend, canOnReceive } from './emit.js';
import { callback } from './callback.js';

/**
 * A CAN bus controller: `const bus = new CAN(); bus.begin(); bus.send(0x123,
 * [0x11, 0x22]);`. Frame ids are 11-bit standard (or 29-bit with `extended`);
 * payloads are up to 8 bytes. `onReceive` fires from the controller's
 * interrupt context for every frame the filter accepts — the ISR discipline
 * (set a variable, post to a queue; don't busy-work).
 */
export class CAN {
  private readonly _instance: number;
  private readonly _hz: number = 500000;
  private readonly _loopback: boolean = false;

  /** Construct a bus handle. `instance` selects the controller (0 = the
   *  board's first — the only one on virtually every board); `hz` is the
   *  bus bitrate (default 500 kbit/s, the automotive middle); `loopback`
   *  routes every sent frame back to this controller's own filters — no
   *  transceiver, no bus — the bench-test mode. */
  constructor(instance: number = 0, opts: { hz?: number; loopback?: boolean } = {}) {
    this._instance = instance;
    void opts;
  }

  /** Configure and start the controller — applies the constructed mode +
   *  bitrate, then starts once. Idempotent. */
  begin(): void {
    canBegin(this._instance, this._hz, this._loopback);
  }

  /** Send one frame: `send(0x123, [0x11, 0x22])`. `id` is the 11-bit
   *  standard identifier (29-bit with `extended: true`); `data` is up to
   *  8 bytes. Blocks briefly until the controller accepts the frame. */
  send(id: number, data: number[], extended: boolean = false): void {
    canSend(this._instance, id, extended, data);
  }

  /** Register the receive handler — fires for every frame the accept-all
   *  filter passes: `(id, len, b0…b7)` with unused bytes zero. Annotate the
   *  callback's parameters (`(id: number, len: number, …) => void`). */
  onReceive(handler: (id: number, len: number, b0: number, b1: number, b2: number, b3: number, b4: number, b5: number, b6: number, b7: number) => void): void {
    canOnReceive(this._instance, callback(handler));
  }
}
