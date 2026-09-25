// ---------------------------------------------------------------------------
// Strip — addressable RGB LED strip (WS2812/SK6812) over the led_strip API
//
// The strip rides one of the board's wired SPI buses (Zephyr's ws2812-spi
// driver synthesizes the waveform on the bus's MOSI line — the board-equal
// form: whatever pads the board's devicetree routes that SPI to are the pads
// the strip can use). `count` is the chain length and a CONSTRUCTION fact —
// the pixel buffer is sized at build time. set/fill/clear edit the buffer
// only; show() flushes it with led_strip_update_rgb — one wire transaction
// per show, the Arduino-Neopixel discipline.
// ----------------------------------------------------------------------------

import { stripSetPixel, stripFill, stripShow } from './emit.js';

/**
 * An addressable RGB LED strip: `const strip = new Strip(SPI0, { count:
 * 30 }); strip.fill(255, 0, 0); strip.show();`. Colors are 0–255 per
 * channel; the driver applies the strip's color order (GRB for WS2812).
 * Buffer edits (set/fill/clear) are local — show() pushes them out.
 */
export class Strip {
  private readonly _bus: string;
  private readonly _count: number;

  /** Construct a strip on a wired SPI bus. `count` is the chain length —
   *  the number of pixels in the buffer (required). */
  constructor(bus: string, opts: { count: number }) {
    this._bus = bus;
    this._count = opts.count;
  }

  /** Set one pixel's color (0–255 per channel). Buffer-only — show()
   *  flushes. */
  set(index: number, r: number, g: number, b: number): void {
    stripSetPixel(this._bus, this._count, index, r, g, b);
  }

  /** Set every pixel to one color. Buffer-only — show() flushes. */
  fill(r: number, g: number, b: number): void {
    stripFill(this._bus, this._count, r, g, b);
  }

  /** Push the buffer to the strip — one wire transaction. */
  show(): void {
    stripShow(this._bus, this._count);
  }

  /** Zero the buffer. Buffer-only — follow with show() to darken the
   *  strip. */
  clear(): void {
    stripFill(this._bus, this._count, 0, 0, 0);
  }
}
