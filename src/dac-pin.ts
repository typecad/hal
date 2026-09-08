// ---------------------------------------------------------------------------
// DAC — the thin Zephyr-shaped analog output
//
// Construction carries the resolution (default: the chip descriptor's channel
// resolution); write() lowers to a lazy dac_channel_setup (once) +
// dac_write_value with the RAW code — no 0–255 Arduino range.
// ----------------------------------------------------------------------------

import { dacWriteValue } from './emit.js';
import type { Pin } from './gpio.js';

export class DAC {
  private readonly _pin: number;
  private readonly _resolution: number;

  /** Construct a DAC channel. `resolution` in bits; 0/omitted = the chip
   *  descriptor's channel resolution (e.g. 8 on the ESP32's two channels). */
  constructor(pin: number | Pin, opts?: { resolution?: number }) {
    this._pin = typeof pin === 'number' ? pin : pin.number;
    this._resolution = opts?.resolution ?? 0;
  }

  /** Write the raw code (dac_write_value). For an 8-bit channel the range
   *  is 0–255; for 12-bit, 0–4095 — the channel's resolution decides. */
  write(value: number): void {
    dacWriteValue(this._pin, value, this._resolution);
  }
}
