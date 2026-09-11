// ---------------------------------------------------------------------------
// DAC — the thin Zephyr-shaped analog output
//
// Construction carries the resolution (default: the chip descriptor's channel
// resolution); write() lowers to a lazy dac_channel_setup (once) +
// dac_write_value with the RAW code — no 0–255 Arduino range.
// ----------------------------------------------------------------------------

import { dacWriteValue } from './emit.js';
import type { Pin } from './gpio.js';

/**
 * An analog output channel: `new DAC(PA4)`. `write(value)` takes the raw
 * code for the channel's resolution — the full range, 0–255 on an 8-bit
 * channel, 0–4095 on 12-bit.
 */
export class DAC {
  private readonly _pin: number;
  private readonly _resolution: number;

  /** Construct a DAC channel. `resolution` in bits; omitted = the chip's
   *  channel resolution. */
  constructor(pin: number | Pin, opts?: { resolution?: number }) {
    this._pin = typeof pin === 'number' ? pin : pin.number;
    this._resolution = opts?.resolution ?? 0;
  }

  /** Write the raw output code. The valid range follows the channel's
   *  resolution: 0–255 for 8-bit, 0–4095 for 12-bit. */
  write(value: number): void {
    dacWriteValue(this._pin, value, this._resolution);
  }
}
