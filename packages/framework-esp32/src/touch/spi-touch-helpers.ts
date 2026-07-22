// ---------------------------------------------------------------------------
// Shared SPI touch helpers — device handle + bus-add for SPI touch controllers
// (XPT2046, STMPE610) that share SPI2_HOST with the display.
//
// The display adapter already calls spi_bus_initialize(SPI2_HOST, ...). Touch
// controllers on the same bus (standard 4-wire SPI topology: shared
// MOSI/MISO/SCK, separate CS) just call spi_bus_add_device(SPI2_HOST, ...)
// with their own CS pin and clock speed. No runtime lock needed — the SPI
// driver serializes transactions per-device internally.
//
// CS is driven manually via gpio_set_level (matching the display adapter's
// .spics_io_num = -1 pattern).
// ---------------------------------------------------------------------------

import { getActiveChip } from '../chips/index.js';

/**
 * Emit the shared SPI touch state struct + device-add helper.
 * Returns the C++ declaration + init boilerplate that XPT2046 and STMPE610
 * adapters prepend to their protocol-specific functions.
 */
export function emitSpiTouchHelpers(csPin: number, spiHz: number, spiMode: number): {
  includes: string[];
  declaration: string;
  initLines: string;
} {
  const chip = getActiveChip();
  const spi0 = chip.spi.controllers[0];
  if (!spi0) throw new Error(`ESP32 chip ${chip.id} has no SPI controller 0`);

  return {
    includes: [
      `#include "driver/spi_master.h"`,
      `#include "driver/gpio.h"`,
    ],
    declaration: [
      `// SPI touch state — device handle on the shared SPI2_HOST bus,`,
      `// separate from the display's device handle. CS driven manually.`,
      `struct __Esp32SpiTouchCtx {`,
      `  spi_device_handle_t dev;`,
      `  int cs_pin;`,
      `  bool ready;`,
      `};`,
      `static __Esp32SpiTouchCtx __esp32_spi_touch = { NULL, ${csPin}, false };`,
    ].join('\n'),
    initLines: [
      `  gpio_set_direction((gpio_num_t)${csPin}, GPIO_MODE_OUTPUT);`,
      `  gpio_set_level((gpio_num_t)${csPin}, 1);  // CS idle high`,
      `  if (!__esp32_spi_touch.dev) {`,
      `#pragma GCC diagnostic push`,
      `#pragma GCC diagnostic ignored "-Wmissing-field-initializers"`,
      `    spi_device_interface_config_t devcfg = {`,
      `      .mode = ${spiMode},`,
      `      .clock_speed_hz = ${spiHz},`,
      `      .spics_io_num = -1,  // CS driven manually`,
      `      .queue_size = 1,`,
      `    };`,
      `#pragma GCC diagnostic pop`,
      `    // SPI2_HOST bus is already initialized by the display adapter.`,
      `    // spi_bus_add_device tolerates multiple devices on one bus.`,
      `    if (spi_bus_add_device(${spi0.host}, &devcfg, &__esp32_spi_touch.dev) != ESP_OK) {`,
      `      __esp32_spi_touch.dev = NULL;`,
      `    }`,
      `  }`,
      `  __esp32_spi_touch.ready = (__esp32_spi_touch.dev != NULL);`,
    ].join('\n'),
  };
}

/**
 * Emit a full-duplex SPI transfer helper: send a command byte while reading
 * the response from the previous command. Returns the 16-bit response.
 * Used by XPT2046 (streaming ADC — result comes back during the NEXT command).
 */
export function emitSpiTouchXfer16(): string {
  return [
    `// Full-duplex 16-bit SPI transfer: send cmd byte + dummy, read 16-bit response.`,
    `// The XPT2046 returns the PREVIOUS command's result during this transfer.`,
    `static inline uint16_t __esp32_touch_xfer16(uint8_t cmd) {`,
    `  if (!__esp32_spi_touch.dev) return 0;`,
    `  uint8_t tx[2] = { cmd, 0x00 };`,
    `  uint8_t rx[2] = { 0, 0 };`,
    `  spi_transaction_t t = {};`,
    `  t.length = 16;`,
    `  t.tx_buffer = tx;`,
    `  t.rx_buffer = rx;`,
    `  spi_device_polling_transmit(__esp32_spi_touch.dev, &t);`,
    `  return ((uint16_t)rx[0] << 8) | rx[1];`,
    `}`,
  ].join('\n');
}

/**
 * Emit CS assert/deassert helpers (manual GPIO toggle around transactions).
 */
export function emitSpiTouchCS(): string {
  return [
    `static inline void __esp32_touch_cs_low() {`,
    `  gpio_set_level((gpio_num_t)__esp32_spi_touch.cs_pin, 0);`,
    `}`,
    `static inline void __esp32_touch_cs_high() {`,
    `  gpio_set_level((gpio_num_t)__esp32_spi_touch.cs_pin, 1);`,
    `}`,
  ].join('\n');
}
