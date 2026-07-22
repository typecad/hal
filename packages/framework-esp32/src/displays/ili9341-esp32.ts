// ---------------------------------------------------------------------------
// ESP32 native ILI9341 display adapter — RGB565 SPI TFT (240x320).
//
// Drives the panel through ESP-IDF's spi_master driver via a dedicated device
// handle (__tc_spi_display_dev) on SPI2_HOST. No Adafruit library link, no
// Arduino-ESP32 core dependency.
//
// Bus ownership: .spics_io_num = -1 — the SPI driver does NOT toggle CS.
// The adapter toggles CS/DC via gpio_set_level before/after each transaction.
//
// ──── BSD-3-Clause attribution ────────────────────────────────────────────
// The ILI9341 panel init command table emitted by this adapter is transcribed
// from Adafruit's Adafruit_ILI9341 library:
//
//   Adafruit_ILI9341.cpp initcmd[]
//   Copyright (c) 2013 Adafruit Industries. All rights reserved.
//   Licensed under BSD-3-Clause.
//   Upstream: https://github.com/adafruit/Adafruit_ILI9341
//
// The init bytes themselves are manufacturer (Ilitek) reference code from the
// ILI9341 datasheet; they appear verbatim across many libraries under various
// licenses. The transcription here is from Adafruit's published source.
// ──── End BSD-3-Clause attribution ────────────────────────────────────────
//
// Memory model: direct mode. Every draw call hits the panel via setAddrWindow
// + writePixels. PSRAM-backed offscreen canvases are supported for AA text
// and scroll compositing.
// ---------------------------------------------------------------------------

import type { DisplayAdapterGenerator, ResolvedDisplay } from "@typecad/cuttlefish/api/shared";
import { getActiveChip } from "../chips/index.js";
import {
  esp32SpiDisplayState,
  esp32SpiBusInit,
  esp32SpiCmdDataHelpers,
  esp32SpiPanelOps,
  esp32SpiAdapterSurface,
  esp32SpiDisplayIncludes,
} from "./esp32-spi-display-helpers.js";

export const esp32Ili9341Adapter: DisplayAdapterGenerator = (display) => {
  const w = display.width;
  const h = display.height;
  const rotation = display.rotation ?? 1;
  const spiHz = display.spiFrequency ?? 40_000_000;
  const colorOrder = display.colorOrder ?? "bgr";

  // SPI2_HOST is the conventional display bus on ESP32-S3.
  const chip = getActiveChip();
  const spi0 = chip.spi.controllers[0];
  if (!spi0) throw new Error(`ESP32 chip ${chip.id} has no SPI controller 0`);
  const spiMode = 0;

  // MADCTL byte: combines orientation bits (rotation) with the color-order
  // bit (BGR). Transcribed from Adafruit_ILI9341::setRotation() (see
  // demos/demo-st/lib/Adafruit_ILI9341/Adafruit_ILI9341.cpp):
  //   rotation 0 (portrait)         → MX
  //   rotation 1 (landscape)        → MV
  //   rotation 2 (portrait flipped) → MY
  //   rotation 3 (landscape flipped)→ MX | MY | MV
  // Color order: BGR adds 0x08; RGB is 0x00.
  // MADCTL_MY=0x80, _MX=0x40, _MV=0x20, _BGR=0x08.
  const colorBit = colorOrder === "bgr" ? 0x08 : 0x00;
  const rotationBits = (() => {
    switch (rotation & 3) {
      case 0: return 0x40;            // MX
      case 1: return 0x20;            // MV (landscape)
      case 2: return 0x80;            // MY
      case 3: return 0x40 | 0x80 | 0x20; // MX | MY | MV
      default: return 0x20;           // defensive: landscape
    }
  })();
  const madctl = rotationBits | colorBit;

  return {
    includes: [
      `// --- ESP32 ILI9341 driver (RGB565, SPI via spi_master) ---`,
      `// No vendor GFX library, no Arduino SPI header.`,
      `#define CuttlefishDisplayTarget CuttlefishGFX`,
      `#define CuttlefishCanvas16 CuttlefishCanvas16`,
      esp32SpiDisplayIncludes(),
    ].join("\n"),

    declaration: [
      esp32SpiDisplayState(display, 0),
      `CuttlefishGFX __tc_display(&__esp32_display_ops, &__esp32_display);`,
    ].join("\n"),

    functions: [
      esp32SpiCmdDataHelpers(),
      esp32SpiPanelOps("ili9341"),

      `// ── display_init: bus + device setup + ILI9341 panel init ─────────────`,
      `static inline void display_init() {`,
      `  // Configure CS/DC/RST as outputs.`,
      `  gpio_set_direction((gpio_num_t)__esp32_display.cs_pin,  GPIO_MODE_OUTPUT);`,
      `  gpio_set_direction((gpio_num_t)__esp32_display.dc_pin,  GPIO_MODE_OUTPUT);`,
      `  gpio_set_level((gpio_num_t)__esp32_display.cs_pin, 1);  // CS high = idle`,
      `  gpio_set_level((gpio_num_t)__esp32_display.dc_pin, 1);`,
      `  __esp32_spi_reset();`,
      `  __esp32_display.width  = ${w};`,
      `  __esp32_display.height = ${h};`,
      esp32SpiBusInit(0, spi0.host, spi0.defaultMosi, spi0.defaultSclk, spi0.defaultMiso, spiHz, spiMode),

      `  // ILI9341 init — transcribed from Adafruit_ILI9341.cpp initcmd[].`,
      `  // Each __esp32_spi_cmd_data call sends {cmd, data...} — byte[0] is the`,
      `  // command (DC low), remaining bytes are data (DC high). The Adafruit`,
      `  // table's count byte is NOT sent to the panel.`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0xEF, 0x03, 0x80, 0x02 }, 4);`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0xCF, 0x00, 0xC1, 0x30 }, 4);`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0xED, 0x64, 0x03, 0x12, 0x81 }, 5);`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0xE8, 0x85, 0x00, 0x78 }, 4);`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0xCB, 0x39, 0x2C, 0x00, 0x34, 0x02 }, 6);`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0xF7, 0x20 }, 2);`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0xEA, 0x00, 0x00 }, 3);`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0xC0, 0x23 }, 2);   // PWCTR1`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0xC1, 0x10 }, 2);   // PWCTR2`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0xC5, 0x3e, 0x28 }, 3);   // VMCTR1`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0xC7, 0x86 }, 2);   // VMCTR2`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0x36, ${"0x" + madctl.toString(16)} }, 2);   // MADCTL`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0x37, 0x00 }, 2);   // VSCRSADD`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0x3A, 0x55 }, 2);   // PIXFMT: 565`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0xB1, 0x00, 0x18 }, 3);   // FRMCTR1`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0xB6, 0x08, 0x82, 0x27 }, 4);   // DFUNCTR`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0xF2, 0x00 }, 2);   // 3Gamma disable`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0x26, 0x01 }, 2);   // GAMMASET`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0xE0, 0x0F, 0x31, 0x2B, 0x0C, 0x0E, 0x08, 0x4E, 0xF1, 0x37, 0x07, 0x10, 0x03, 0x0E, 0x09, 0x00 }, 16),`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0xE1, 0x00, 0x0E, 0x14, 0x03, 0x11, 0x07, 0x31, 0xC1, 0x48, 0x08, 0x0F, 0x0C, 0x31, 0x36, 0x0F }, 16),`,
      `  __esp32_spi_cmd(0x11);   // SLPOUT`,
      `  vTaskDelay(pdMS_TO_TICKS(150));`,
      `  __esp32_spi_cmd(0x29);   // DISPON`,
      `  vTaskDelay(pdMS_TO_TICKS(150));`,
      `  // Fill black on init.`,
      `  __esp32_op_fillRect(NULL, 0, 0, ${w}, ${h}, 0x0000);`,
      `  (void)${rotation};  // rotation applied via MADCTL byte above`,
      `}`,

      ``,
      `static inline void display_fillScreen(UI_COLOR_T color) {`,
      `  __esp32_op_fillRect(NULL, 0, 0, ${w}, ${h}, (uint16_t)color);`,
      `}`,
      `static inline CuttlefishDisplayTarget* display_defaultTarget() { return &__tc_display; }`,
      `static inline int16_t display_width()  { return ${w}; }`,
      `static inline int16_t display_height() { return ${h}; }`,

      ``,
      esp32SpiAdapterSurface(),
    ].join("\n"),
  };
};
