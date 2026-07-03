// ---------------------------------------------------------------------------
// Built-in display profiles for @typecad/framework-arduino.
//
// Each profile describes a common display's capabilities. Projects reference
// them by name in cuttlefish.config.ts:
//   display: { profile: 'ili9341-spi', cs: 5, dc: 21, rst: 22 }
// ---------------------------------------------------------------------------

import type { DisplayProfile } from "@typecad/cuttlefish/api/shared";
import { SSD1309_I2C } from "./ssd1309-i2c.js";

export const ILI9341_SPI: DisplayProfile = {
  driver: "ili9341",
  width: 320,
  height: 240,
  colorFormat: "rgb565",
  rotation: 1,
  backlight: 17,
  spiPins: { mosi: 23, sck: 18, miso: 19 },
};

/** Registry of all built-in profiles. Keyed by profile name. */
export const BUILT_IN_PROFILES: Record<string, DisplayProfile> = {
  "ili9341-spi": ILI9341_SPI,
  "ssd1309-i2c": SSD1309_I2C,
};

/** Get the registry as a Map (for resolveDisplayProfile). */
export function getProfileRegistry(): Map<string, DisplayProfile> {
  return new Map(Object.entries(BUILT_IN_PROFILES));
}
