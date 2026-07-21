// ---------------------------------------------------------------------------
// ESP32 native ST7796S display adapter — RGB565 SPI TFT (320x480).
//
// Same transport shape as ILI9341 (ESP-IDF spi_master on SPI2_HOST), but with
// the ST7796S-specific init sequence: manufacturer unlock (0xF0,0xC3 then
// 0xF0,0x96) before the standard power/VCOM/MADCTL/COLMOD sequence.
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

  // MADCTL: 0x40 (MX) + 0x08 if BGR. Matches Adafruit_ST7796S's colorOrder handling.
  const madctl = colorOrder === "bgr" ? 0x48 : 0x40;

  // Inversion command: 0x21 INVON or 0x20 INVOFF, sent after sleep-out.
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

      `  // ST7796S init — transcribed from Adafruit_ST7796S_kbv.cpp initcmd[].`,
      `  // Manufacturer unlock must precede every other register write.`,
      `  { uint8_t b1[]  = { 0x01, 0 }; __esp32_spi_cmd(0x01); vTaskDelay(pdMS_TO_TICKS(150)); }  // soft reset`,
      `  { uint8_t b2[]  = { 0xF0, 1, 0xC3 }; __esp32_spi_cmd_data(b2, 3); }  // unlock`,
      `  { uint8_t b3[]  = { 0xF0, 1, 0x96 }; __esp32_spi_cmd_data(b3, 3); }`,
      `  { uint8_t b4[]  = { 0xC5, 1, 0x1C }; __esp32_spi_cmd_data(b4, 3); }  // VCOM control`,
      `  { uint8_t b5[]  = { 0x36, 1, ${"0x" + madctl.toString(16)} }; __esp32_spi_cmd_data(b5, 3); }  // MADCTL (MX + BGR when configured)`,
      `  { uint8_t b6[]  = { 0x3A, 1, 0x55 }; __esp32_spi_cmd_data(b6, 3); }  // 565 (16-bit/pixel)`,
      `  { uint8_t b7[]  = { 0xB0, 1, 0x80 }; __esp32_spi_cmd_data(b7, 3); }  // Interface`,
      `  { uint8_t b8[]  = { 0xB4, 1, 0x01 }; __esp32_spi_cmd_data(b8, 3); }  // Inversion control`,
      `  { uint8_t b9[]  = { 0xB6, 3, 0x80, 0x02, 0x3B }; __esp32_spi_cmd_data(b9, 5); }  // Display function control`,
      `  { uint8_t b10[] = { 0xB7, 1, 0xC6 }; __esp32_spi_cmd_data(b10, 3); }  // Entry mode`,
      `  { uint8_t b11[] = { 0xF0, 1, 0x69 }; __esp32_spi_cmd_data(b11, 3); }  // lock manufacturer`,
      `  { uint8_t b12[] = { 0xF0, 1, 0x3C }; __esp32_spi_cmd_data(b12, 3); }`,
      `  __esp32_spi_cmd(0x11);   // SLPOUT`,
      `  vTaskDelay(pdMS_TO_TICKS(150));`,
      `  __esp32_spi_cmd(${invCmd});  // INVON or INVOFF per config`,
      `  __esp32_spi_cmd(0x29);   // DISPON`,
      `  vTaskDelay(pdMS_TO_TICKS(150));`,
      `  __esp32_op_fillRect(NULL, 0, 0, ${w}, ${h}, 0x0000);`,
      `  (void)${rotation};`,
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
