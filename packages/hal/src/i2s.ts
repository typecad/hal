// ---------------------------------------------------------------------------
// I2S — the thin Zephyr-shaped audio stream
//
// One controller per instance (the harvested i2s@ node — ESP32 I2S0/1); the
// class addresses it by its devicetree nodelabel. The verbs own their setup
// (the PWM first-use discipline): the first write() configures + starts the
// TX direction, the first read() the RX — a write-only program (tone to an
// amplifier) never touches the RX engine. Samples are 16-bit; one block per
// call (blockFrames stereo frames, zero-padded on short writes).
//
// The hardware loopback (one jumper from the board's O_SD pad to I_SD) is
// the zero-parts bench test: write tones, read them back.
// ----------------------------------------------------------------------------

import { i2sWrite, i2sRead, i2sReadAt } from './emit.js';

/**
 * An I2S audio stream: `const mic = new I2S(0, { hz: 16000 }); mic.write(
 * [0, 4096, 0, -4096]); const s = mic.read();`. Construction carries the
 * wire facts — sample rate (`hz`, default 16 kHz), `channels` (1 mono /
 * 2 stereo, default 2), `bits` per sample (16), and `blockFrames` (the
 * block granularity, default 64 frames).
 */
export class I2S {
  private readonly _instance: number;
  private readonly _hz: number = 16000;
  private readonly _channels: number = 2;
  private readonly _bits: number = 16;
  private readonly _blockFrames: number = 64;

  /** Construct a stream handle. `instance` selects the controller (0 = the
   *  board's first — I2S0 on the ESP32 family). */
  constructor(instance: number = 0, opts: { hz?: number; channels?: number; bits?: number; blockFrames?: number } = {}) {
    this._instance = instance;
    void opts;
  }

  /** Send one block of 16-bit samples (≤ blockFrames × channels entries;
   *  short writes zero-pad). The first call configures and starts the TX
   *  direction. A stereo frame is two consecutive entries (L, R). */
  write(samples: number[]): void {
    i2sWrite(this._instance, this._hz, this._channels, this._bits, this._blockFrames, samples);
  }

  /** Receive one block; returns the FIRST sample. The first call
   *  configures and starts the RX direction. */
  read(): number {
    return i2sRead(this._instance, this._hz, this._channels, this._bits, this._blockFrames);
  }

  /** Element `index` of the last received block (0 .. blockFrames ×
   *  channels − 1) — the first call also starts the RX stream (0 until a
   *  block has actually arrived). */
  readAt(index: number): number {
    return i2sReadAt(this._instance, index);
  }
}
