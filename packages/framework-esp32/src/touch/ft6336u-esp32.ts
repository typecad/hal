// ---------------------------------------------------------------------------
// ESP32 native FT6336U touch adapter — capacitive I2C touch controller.
//
// ──── BSD-3-Clause attribution ────────────────────────────────────────────
// The FT6336U register protocol (register 0x02 = touch status, 0x03-0x06 =
// coordinate parsing) emitted by this adapter is transcribed from the
// RAK14014_FT6336U library used in the Arduino path:
//
//   RAK14014_FT6336U.cpp / RAK14014_FT6336U.h
//   Copyright (c) RAK Wireless.
//   Licensed under BSD-3-Clause.
//
// The register addresses and byte-layout parsing are factual hardware
// interface descriptions from the FT6336U datasheet; the implementation
// (ESP-IDF i2c_master transactions) is independently written.
// ──── End BSD-3-Clause attribution ─────────────────────────────────────────
//
// Drives the FT6336U (RAK14014, common on ST7796S panel modules) through
// ESP-IDF's i2c_master driver via a dedicated device handle on I2C0
// (__esp32_i2c_touch_*), separate from any display I2C device handle so a
// touch + I2C display coexist cleanly. The bus itself (I2C_NUM_0) is shared
// when both the display and touch are I2C — ESP-IDF v5+ i2c_master supports
// multiple device handles per bus, and this adapter's bus-init is idempotent.
//
// Mirrors the surface the runtime expects: touch_init(), touch_isTouched(),
// touch_readRaw(x,y,z). The coordinate mapping / calibration / state machine
// are all framework-agnostic (in cuttlefish's ui-emitter + the UI runtime
// header) and consume this adapter's output unchanged.
//
// Pin wiring (matches demos/demo-st's Arduino path):
//   SDA → chip's default I2C0 SDA pin (from the chip descriptor)
//   SCL → chip's default I2C0 SCL pin
//   RST → user-supplied resetPin (gpio_set_level low→high on init)
//   IRQ → user-supplied irq pin (driven low by the FT6336U on touch; polled)
//
// Register protocol (from the RAK14014_FT6336U datasheet):
//   0x02: TD_STATUS — bits[3:0] = number of touch points (0..1 for FT6336U)
//   0x03..0x04: P1_XH, P1_XL — x position (high nibble of [0x03] + [0x04])
//   0x05..0x06: P1_YH, P1_YL — y position (high nibble of [0x05] + [0x06])
// Reading 5 bytes from register 0x02 returns all of these in one transaction.
// ---------------------------------------------------------------------------

import type { TouchProfile } from "@typecad/cuttlefish/api/shared";

/**
 * Shape of the touch adapter codegen output (mirrors TouchAdapterCodegen from
 * cuttlefish — duplicated here as a structural type to avoid a stale-dist
 * dependency while the cuttlefish .d.ts regen is blocked by TS5055).
 */
export interface TouchAdapterCodegen {
  includes: string[];
  declaration: string;
  functions: string;
}

/**
 * Native ESP32 FT6336U touch adapter generator. Emits C++ that drives the
 * controller via ESP-IDF i2c_master (no Arduino Wire, no RAK14014 library).
 */
export function esp32Ft6336uTouchAdapter(touch: TouchProfile): TouchAdapterCodegen {
  const addr = touch.i2cAddress ?? 0x38;
  const addrHex = "0x" + addr.toString(16);
  const i2cFrequency = touch.i2cFrequency ?? 400000;
  const resetPin = touch.resetPin;
  const irqPin = touch.irq;

  if (resetPin === undefined || resetPin < 0) {
    throw new Error(
      `FT6336U native touch adapter requires display.touch.resetPin (a GPIO ` +
      `connected to the controller's RST line). The hardware-reset sequence is ` +
      `required for reliable init on ESP-IDF. Set it in cuttlefish.config.ts: ` +
      `display: { touch: { ..., resetPin: <gpio> } }.`,
    );
  }

  const resetLines = [
    `  gpio_set_direction((gpio_num_t)${resetPin}, GPIO_MODE_OUTPUT);`,
    `  gpio_set_level((gpio_num_t)${resetPin}, 0);`,
    `  vTaskDelay(pdMS_TO_TICKS(10));`,
    `  gpio_set_level((gpio_num_t)${resetPin}, 1);`,
    `  vTaskDelay(pdMS_TO_TICKS(500));`,
  ].join("\n");

  // The FT6336U IRQ pin is configured for reporting mode "0" (trigger on
  // initial touch then deassert). It does NOT stay low during continuous
  // contact, so checking gpio_get_level(irq) between drag frames would
  // incorrectly report "no touch" and break scroll-drag. Instead we always
  // read the I2C register — matching the Arduino path, which never uses IRQ
  // for the live "is touched" decision.
  //
  // The IRQ pin is configured as input but NOT read in the current polling
  // path — it's a stub reserved for a future interrupt-driven wake-from-sleep
  // implementation. Setting it as input is harmless (the pin floats or is
  // driven by the controller) and avoids leaving it in an undefined state.
  // TODO(future): implement ISR-based touch wake using gpio_isr_handler_add.
  const irqInit = irqPin !== undefined && irqPin >= 0
    ? `  gpio_set_direction((gpio_num_t)${irqPin}, GPIO_MODE_INPUT);  // reserved for future ISR wake`
    : ``;

  return {
    includes: [
      `// --- ESP32 FT6336U touch driver (I2C via i2c_master, IRQ polled) ---`,
      `// No vendor touch library, no Arduino Wire header.`,
      `#include "driver/i2c_master.h"`,
      `#include "driver/gpio.h"`,
    ],

    declaration: [
      `// ESP32 touch I2C state — device handle on the shared I2C bus.`,
      `// The bus itself is fetched via __esp32_i2c_bus_get(0) so touch, display,`,
      `// and user I2C all share one bus handle (B1 fix).`,
      `struct __Esp32I2cTouchCtx {`,
      `  i2c_master_dev_handle_t dev;`,
      `  bool ready;`,
      `};`,
      `static __Esp32I2cTouchCtx __esp32_i2c_touch = { NULL, false };`,
      `// Cached touch coordinates from the last touch_isTouched() probe.`,
      `static int16_t __esp32_touch_cached_x = 0;`,
      `static int16_t __esp32_touch_cached_y = 0;`,
      `static int16_t __esp32_touch_cached_z = 0;`,
      `static uint8_t __esp32_touch_cached_valid = 0;`,
    ].join("\n"),

    functions: [
      `// Read N bytes starting from a register address (the native equivalent`,
      `// of the Arduino Wire block-read pattern). Returns 1 on success, 0 on`,
      `// any I2C error. Uses a bounded timeout so a stuck SDA line can't freeze`,
      `// the UI thread — touch_isTouched() runs every frame from ui_poll_touch.`,
      `static inline uint8_t __esp32_touch_read_block(uint8_t reg, uint8_t* buf, uint8_t len) {`,
      `  if (!__esp32_i2c_touch.dev) return 0;`,
      `  esp_err_t err = i2c_master_transmit_receive(__esp32_i2c_touch.dev, &reg, 1, buf, len, pdMS_TO_TICKS(50));`,
      `  return (err == ESP_OK) ? 1 : 0;`,
      `}`,
      ``,
      `static inline void touch_init() {`,
      resetLines,
      `  // Fetch the shared I2C bus handle (created idempotently by the store).`,
      `  i2c_master_bus_handle_t bus = __esp32_i2c_bus_get(0);`,
      `  if (bus && !__esp32_i2c_touch.dev) {`,
      `    i2c_device_config_t dcfg = {};`,
      `    dcfg.dev_addr_length = I2C_ADDR_BIT_LEN_7;`,
      `    dcfg.device_address = ${addrHex};`,
      `    dcfg.scl_speed_hz = ${i2cFrequency};`,
      `    if (i2c_master_bus_add_device(bus, &dcfg, &__esp32_i2c_touch.dev) != ESP_OK) {`,
      `      __esp32_i2c_touch.dev = NULL;  // device-add failed — touch won't work`,
      `    }`,
      `  }`,
      irqInit,
      `  __esp32_i2c_touch.ready = (__esp32_i2c_touch.dev != NULL);`,
      `}`,
      ``,
      `static inline bool touch_isTouched() {`,
      `  if (!__esp32_i2c_touch.ready) return false;`,
      `  __esp32_touch_cached_valid = 0;`,
      `  __esp32_touch_cached_z = 0;`,
      `  // Read TD_STATUS (0x02) + P1_XH/XL/YH/YL — 5 bytes in one transaction.`,
      `  uint8_t buf[5] = {0, 0, 0, 0, 0};`,
      `  if (!__esp32_touch_read_block(0x02, buf, 5)) return false;`,
      `  uint8_t count = buf[0] & 0x0F;`,
      `  if (count == 0) return false;`,
      `  __esp32_touch_cached_x = static_cast<int16_t>((static_cast<uint16_t>(buf[1] & 0x0F) << 8) | buf[2]);`,
      `  __esp32_touch_cached_y = static_cast<int16_t>((static_cast<uint16_t>(buf[3] & 0x0F) << 8) | buf[4]);`,
      `  __esp32_touch_cached_z = 255;`,
      `  __esp32_touch_cached_valid = 1;`,
      `  return true;`,
      `}`,
      ``,
      `static inline void touch_readRaw(int16_t* x, int16_t* y, int16_t* z) {`,
      `  // touch_isTouched() is polled each frame by ui_poll_touch; the cached`,
      `  // values are fresh. If something calls readRaw before isTouched, probe now.`,
      `  if (!__esp32_touch_cached_valid) {`,
      `    (void)touch_isTouched();`,
      `  }`,
      `  if (x) *x = __esp32_touch_cached_x;`,
      `  if (y) *y = __esp32_touch_cached_y;`,
      `  if (z) *z = __esp32_touch_cached_z;`,
      `  __esp32_touch_cached_valid = 0;`,
      `}`,
    ].join("\n"),
  };
}
