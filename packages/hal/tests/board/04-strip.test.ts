import { describe, done } from '@typecad/hal/testing';
// @typecad-requires-roles cs
// Addressable-strip verbs over the board's first wired SPI bus (the
// ws2812-spi driver synthesizes the waveform on MOSI — no strip needs to be
// attached for construction and show() to prove the driver + DT node build
// and the buffer discipline runs without trapping; the data line simply
// drives whatever is on the pad). The cs role gates the suite the same way
// the SPI suite's does.
import { Strip } from '@typecad/hal';

describe("Strip buffer discipline")
  .it("Strip(bus, { count }) constructs and shows without crashing")
  .expect(
    (() => {
      const strip = new Strip('SPI0', { count: 8 });
      strip.set(0, 255, 0, 0);
      strip.set(7, 0, 0, 255);
      strip.show();
      return 1;
    })
  ).toBe(1)
  .it("fill/clear edit the buffer; show flushes")
  .expect(
    (() => {
      const strip = new Strip('SPI0', { count: 4 });
      strip.fill(255, 255, 0);
      strip.show();
      strip.clear();
      strip.show();
      return 1;
    })
  ).toBe(1)

done();
