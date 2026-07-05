// ---------------------------------------------------------------------------
// Built-in profile for the ST7796S 320×480 SPI TFT.
//
// Targets the Adafruit_ST7735_and_ST7789_Library fork that exposes the
// Adafruit_ST7796S class. RGB565 (the library hardcodes 565 in its init
// sequence; see display-adapters/st7796.ts for the 666 constraint).
//
// Reference usage in cuttlefish.config.ts:
//   display: { profile: 'st7796-spi', cs: 5, dc: 17, rst: 16 }
// ---------------------------------------------------------------------------

import type { DisplayProfile } from "@typecad/cuttlefish/api/shared";

export const ST7796_SPI: DisplayProfile = {
  driver: "st7796",
  width: 480,
  height: 320,
  nativeWidth: 320,
  nativeHeight: 480,
  colorFormat: "rgb565",
  rotation: 1, // landscape → effective 480×320
  spiPins: { mosi: 23, sck: 18, miso: 19 },
};
