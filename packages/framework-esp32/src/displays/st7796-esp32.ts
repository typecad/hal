// ---------------------------------------------------------------------------
// ESP32 native ST7796S display adapter — RGB565 SPI TFT (320x480).
//
// Same transport shape as ILI9341 (ESP-IDF spi_master on SPI2_HOST), but with
// the ST7796S-specific init sequence: manufacturer unlock (0xF0,0xC3 then
// 0xF0,0x96) before the standard power/VCOM/MADCTL/COLMOD sequence.
//
// ──── BSD-3-Clause attribution ────────────────────────────────────────────
// The ST7796S panel init command table emitted by this adapter is transcribed
// from a community-maintained Adafruit-style library:
//
//   Adafruit_ST7796S_kbv.cpp initcmd[]
//   Copyright (c) David Prentice (prenticedavid).
//   Licensed under BSD-3-Clause.
//   Upstream: https://github.com/prenticedavid/Adafruit_ST7796S_kbv
//
// NOTE: this is a third-party community fork, not a canonical Adafruit
// Industries release. The init bytes are manufacturer (SITROX/ST) reference
// code from the ST7796S datasheet; equivalent sequences appear in TFT_eSPI,
// LovyanGFX, and other libraries under various licenses. The transcription
// here is from the Adafruit_ST7796S_kbv source above.
// ──── End BSD-3-Clause attribution ────────────────────────────────────────
//
// This is the adapter the demos/demo-display hardware proof targets. Pin
// wiring (CS=5, DC=17, RST=16) matches demos/demo-st exactly so the same
// hardware setup works for both Adafruit (arduino-cli) and native (ESP-IDF)
// paths.
//
// Bus ownership: .spics_io_num = -1; CS/DC software-driven via gpio_set_level.
// ---------------------------------------------------------------------------

import type { DisplayAdapterGenerator } from "@typecad/cuttlefish/api/shared";
import { getActiveChip } from "../chips/index.js";
import {
  esp32SpiDisplayState,
  esp32SpiBusInit,
  esp32SpiCmdDataHelpers,
  esp32SpiPanelOps,
  esp32SpiAdapterSurface,
  esp32SpiDisplayIncludes,
} from "./esp32-spi-display-helpers.js";

export const esp32St7796Adapter: DisplayAdapterGenerator = (display) => {
  const w = display.width;
  const h = display.height;
  const rotation = display.rotation ?? 1;
  const spiHz = display.spiFrequency ?? 80_000_000;
  const colorOrder = display.colorOrder ?? "rgb";
  const invertDisplay = display.invertDisplay ?? false;

  const chip = getActiveChip();
  const spi0 = chip.spi.controllers[0];
  if (!spi0) throw new Error(`ESP32 chip ${chip.id} has no SPI controller 0`);
  const spiMode = 0;

  // MADCTL byte: combines orientation bits (rotation) with the color-order
  // bit (BGR). Transcribed from Adafruit_ST7796S::setRotation() (see
  // demos/demo-st/lib/Adafruit_ST7735_and_ST7789_Library/Adafruit_ST7796S.cpp):
  //   rotation 0 (portrait)         → MX
  //   rotation 1 (landscape)        → MV  ← the demo's default
  //   rotation 2 (portrait flipped) → MY
  //   rotation 3 (landscape flipped)→ MY | MX | MV
  // Color order: BGR adds 0x08; RGB is 0x00 (no-op bit).
  // ST77XX_MADCTL_MY=0x80, _MX=0x40, _MV=0x20, _RGB=0x00.
  const colorBit = colorOrder === "bgr" ? 0x08 : 0x00;
  const rotationBits = (() => {
    switch (rotation & 3) {
      case 0: return 0x40;            // MX
      case 1: return 0x20;            // MV (landscape)
      case 2: return 0x80;            // MY
      case 3: return 0x80 | 0x40 | 0x20; // MY | MX | MV
      default: return 0x20;           // defensive: landscape
    }
  })();
  const madctl = rotationBits | colorBit;

  // Inversion command. ST7796S modules vary: some power up non-inverted and
  // need INVOFF (0x20, the safe no-op default), others power up inverted and
  // need INVON (0x21) to render correctly. Adafruit_ST7796S always sends 0x21
  // internally (its begin() swaps the INVON/INVOFF labels). Our default
  // matches demo-st's working config (invertDisplay: false → 0x20). The panel
  // tested here (ESP32-S3 + ST7796S, 320x480) is non-inverted at power-on.
  const invCmd = invertDisplay ? "0x21" : "0x20";

  return {
    includes: [
      `// --- ESP32 ST7796S driver (RGB565, SPI via spi_master) ---`,
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
      esp32SpiPanelOps("st7796"),

      `// ── display_init: bus + device setup + ST7796S panel init ─────────────`,
      `static inline void display_init() {`,
      `  gpio_set_direction((gpio_num_t)__esp32_display.cs_pin,  GPIO_MODE_OUTPUT);`,
      `  gpio_set_direction((gpio_num_t)__esp32_display.dc_pin,  GPIO_MODE_OUTPUT);`,
      `  gpio_set_level((gpio_num_t)__esp32_display.cs_pin, 1);`,
      `  gpio_set_level((gpio_num_t)__esp32_display.dc_pin, 1);`,
      `  __esp32_spi_reset();`,
      `  __esp32_display.width  = ${w};`,
      `  __esp32_display.height = ${h};`,
      esp32SpiBusInit(0, spi0.host, spi0.defaultMosi, spi0.defaultSclk, spi0.defaultMiso, spiHz, spiMode),

      `  // ST7796S init — transcribed from Adafruit_ST7796S.cpp st7796s_init[].`,
      `  // Each register write sends {cmd, data...} via __esp32_spi_cmd_data,`,
      `  // which treats byte[0] as the command (DC low) and the rest as data`,
      `  // (DC high). The Adafruit table's count byte is NOT sent to the panel.`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0x01 }, 1); vTaskDelay(pdMS_TO_TICKS(150));  // SWRESET`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0xF0, 0xC3 }, 2);  // unlock manufacturer`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0xF0, 0x96 }, 2);`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0xC5, 0x1C }, 2);  // VCOM control`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0x36, ${"0x" + madctl.toString(16)} }, 2);  // MADCTL (rotation ${rotation & 3} + ${colorOrder})`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0x3A, 0x55 }, 2);  // COLMOD: 565 (16-bit/pixel)`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0xB0, 0x80 }, 2);  // Interface control`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0xB4, 0x00 }, 2);  // Inversion control`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0xB6, 0x80, 0x02, 0x3B }, 4);  // Display function control`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0xB7, 0xC6 }, 2);  // Entry mode`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0xF0, 0x69 }, 2);  // lock manufacturer`,
      `  __esp32_spi_cmd_data((const uint8_t[]){ 0xF0, 0x3C }, 2);`,
      `  __esp32_spi_cmd(0x11);   // SLPOUT`,
      `  vTaskDelay(pdMS_TO_TICKS(150));`,
      `  __esp32_spi_cmd(0x29);   // DISPON`,
      `  vTaskDelay(pdMS_TO_TICKS(150));`,
      `  // Inversion command after DISPON (matches Adafruit_ST7796S::begin(),`,
      `  // which calls invertDisplay() after displayInit() — the init table ends`,
      `  // with DISPON). invertDisplay=false (the default) sends 0x20 (INVOFF),`,
      `  // leaving the panel in its non-inverted power-on state.`,
      `  __esp32_spi_cmd(${invCmd});`,
      `  __esp32_op_fillRect(NULL, 0, 0, ${w}, ${h}, 0x0000);`,
      `  (void)${rotation};  // rotation applied via MADCTL byte above`,
      `}`,

      ``,
      `static inline void display_fillScreen(UI_COLOR_T color) {`,
      `  __esp32_op_fillRect(NULL, 0, 0, ${w}, ${h}, static_cast<uint16_t>(color));`,
      `}`,
      `static inline CuttlefishDisplayTarget* display_defaultTarget() { return &__tc_display; }`,
      `static inline int16_t display_width()  { return ${w}; }`,
      `static inline int16_t display_height() { return ${h}; }`,

      ``,
      esp32SpiAdapterSurface(),
    ].join("\n"),
  };
};
