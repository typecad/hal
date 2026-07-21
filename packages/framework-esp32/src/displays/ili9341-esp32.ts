// ---------------------------------------------------------------------------
// ESP32 native ILI9341 display adapter — RGB565 SPI TFT (240x320).
//
// Drives the panel through ESP-IDF's spi_master driver via a dedicated device
// handle (__tc_spi_display_dev) on SPI2_HOST. No Adafruit, no Arduino-ESP32
// core dependency.
//
// Bus ownership: .spics_io_num = -1 — the SPI driver does NOT toggle CS.
// The adapter toggles CS/DC via gpio_set_level before/after each transaction.
//
// Init sequence: transcribed verbatim from the Adafruit_ILI9341 reference
// initcmd[] (manufacturer power-on sequence + power control + gamma + sleep
// out + display on).
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
} from "./esp32-spi-display-helpers.js";

export const esp32Ili9341Adapter: DisplayAdapterGenerator = (display) => {
  const w = display.width;
  const h = display.height;
  const rotation = display.rotation ?? 1;
  const spiHz = display.spiFrequency ?? 40_000_000;

  // SPI2_HOST is the conventional display bus on ESP32-S3.
  const chip = getActiveChip();
  const spi0 = chip.spi.controllers[0];
  if (!spi0) throw new Error(`ESP32 chip ${chip.id} has no SPI controller 0`);
  const spiMode = 0;

  return {
    includes: [
      `// --- ESP32 ILI9341 driver (RGB565, SPI via spi_master) ---`,
      `// No vendor GFX library, no Arduino SPI header.`,
      `#define CuttlefishDisplayTarget CuttlefishGFX`,
      `#define CuttlefishCanvas16 CuttlefishCanvas16`,
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

      `  // ILI9341 init sequence — transcribed verbatim from Adafruit_ILI9341`,
      `  // initcmd[] (the manufacturer power-on sequence + power control +`,
      `  // gamma + sleep-out + display-on).`,
      `  static const uint8_t init_cmds[][16] = {`,
      `    { 0xEF, 3, 0x03, 0x80, 0x02 },`,
      `    { 0xCF, 3, 0x00, 0xC1, 0x30 },`,
      `    { 0xED, 4, 0x64, 0x03, 0x12, 0x81 },`,
      `    { 0xE8, 3, 0x85, 0x00, 0x78 },`,
      `    { 0xCB, 5, 0x39, 0x2C, 0x00, 0x34, 0x02 },`,
      `    { 0xF7, 1, 0x20 },`,
      `    { 0xEA, 2, 0x00, 0x00 },`,
      `    { 0xC0, 1, 0x23 },   // PWCTR1`,
      `    { 0xC1, 1, 0x10 },   // PWCTR2`,
      `    { 0xC5, 2, 0x3e, 0x28 },   // VMCTR1`,
      `    { 0xC7, 1, 0x86 },   // VMCTR2`,
      `    { 0x36, 1, 0x48 },   // MADCTL: MX | BGR`,
      `    { 0x37, 1, 0x00 },   // VSCRSADD`,
      `    { 0x3A, 1, 0x55 },   // PIXFMT: 16-bit/pixel (565)`,
      `    { 0xB1, 2, 0x00, 0x18 },   // FRMCTR1`,
      `    { 0xB6, 3, 0x08, 0x82, 0x27 },   // DFUNCTR`,
      `    { 0xF2, 1, 0x00 },   // 3Gamma disable`,
      `    { 0x26, 1, 0x01 },   // GAMMASET`,
      `    { 0xE0, 15, 0x0F, 0x31, 0x2B, 0x0C, 0x0E, 0x08, 0x4E, 0xF1, 0x37, 0x07, 0x10, 0x03, 0x0E, 0x09, 0x00 },`,
      `    { 0xE1, 15, 0x00, 0x0E, 0x14, 0x03, 0x11, 0x07, 0x31, 0xC1, 0x48, 0x08, 0x0F, 0x0C, 0x31, 0x36, 0x0F },`,
      `  };`,
      `  for (size_t i = 0; i < sizeof(init_cmds) / sizeof(init_cmds[0]); i++) {`,
      `    __esp32_spi_cmd_data(init_cmds[i], init_cmds[i][1] + 2);`,
      `  }`,
      `  __esp32_spi_cmd(0x11);   // SLPOUT`,
      `  vTaskDelay(pdMS_TO_TICKS(150));`,
      `  __esp32_spi_cmd(0x29);   // DISPON`,
      `  vTaskDelay(pdMS_TO_TICKS(150));`,
      `  // Fill black on init.`,
      `  __esp32_op_fillRect(NULL, 0, 0, ${w}, ${h}, 0x0000);`,
      `  (void)${rotation};  // rotation applied via MADCTL bit 0x80 if needed`,
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
