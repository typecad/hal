// ---------------------------------------------------------------------------
// SSD1309 OLED display profile — 128×64 1-bit monochrome OLED over I2C.
//
// The Adafruit_SSD1306 library drives SSD1309-class panels via the same API.
// displayClass: "eink" triggers the mono capability derivation in
// deriveCapabilities (UI_NATIVE_MONO + UI_REQUIRES_BACKING_STORE), which is
// the only path that produces 1-bit mono snapping. A future cleanup could add
// "oled" as a displayClass alias; functionally "eink" reuses the correct path.
// ---------------------------------------------------------------------------

import type { DisplayProfile } from "@typecad/cuttlefish/api/shared";

export const SSD1309_I2C: DisplayProfile = {
  driver: "ssd1309",
  width: 128,
  height: 64,
  colorFormat: "mono",
  displayClass: "oled",
  rotation: 0,
};
