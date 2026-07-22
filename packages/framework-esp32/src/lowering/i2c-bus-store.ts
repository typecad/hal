// ---------------------------------------------------------------------------
// Shared I2C bus handle store — one i2c_master_bus_handle_t per I2C controller.
//
// ESP-IDF v5+ allows only ONE i2c_new_master_bus() call per i2c_port_t.
// Multiple device handles on that bus are fine (i2c_master_bus_add_device),
// but each adapter (display, touch, user I2C) creating its own bus via
// i2c_new_master_bus() fails silently for the second caller. This module
// provides a single shared bus handle per controller, created idempotently
// by whichever adapter runs first. All consumers then call
// i2c_master_bus_add_device against the shared handle.
//
// This mirrors the SPI bus-sharing pattern: spi_bus_initialize creates the
// bus once, spi_bus_add_device is called per-device against the shared bus,
// and the driver serializes transactions internally — no runtime lock needed.
//
// The handles are emitted as weak symbols so multiple adapters can reference
// them without a header dependency. Each consumer calls
// __esp32_i2c_bus_get(controllerIndex) to fetch the shared handle, creating
// it on first call.
// ---------------------------------------------------------------------------

import { getActiveChip } from '../chips/index.js';

/**
 * Emit the shared I2C bus handle store + getter function.
 * Called once per translation unit (the strategy's shimMacros or forcedIncludes).
 * Generates C++ that all I2C consumers link against.
 */
export function emitSharedI2cBusStore(): string {
  const chip = getActiveChip();
  const controllers = chip.i2c.controllers;
  if (controllers.length === 0) return '';

  const handleDecls = controllers.map((c, i) =>
    `static i2c_master_bus_handle_t __esp32_i2c${i}_bus = NULL;`,
  ).join('\n');

  const getterBodies = controllers.map((c: { host: string; defaultSda: number; defaultScl: number }, i: number) => {
    const sda = `(gpio_num_t)${c.defaultSda}`;
    const scl = `(gpio_num_t)${c.defaultScl}`;
    return [
      `  if (controller == ${i}) {`,
      `    if (__esp32_i2c${i}_bus) return __esp32_i2c${i}_bus;`,
      `    i2c_master_bus_config_t bcfg = {};`,
      `    bcfg.i2c_port = ${c.host};`,
      `    bcfg.sda_io_num = ${sda};`,
      `    bcfg.scl_io_num = ${scl};`,
      `    bcfg.clk_source = I2C_CLK_SRC_DEFAULT;`,
      `    bcfg.glitch_ignore_cnt = 7;`,
      `    bcfg.flags.enable_internal_pullup = 1;`,
      `    if (i2c_new_master_bus(&bcfg, &__esp32_i2c${i}_bus) != ESP_OK) {`,
      `      __esp32_i2c${i}_bus = NULL;  // bus creation failed — callers will see NULL`,
      `    }`,
      `    return __esp32_i2c${i}_bus;`,
      `  }`,
    ].join('\n');
  }).join('\n');

  return [
    `// ── Shared I2C bus handle store (one per controller) ────────────────────`,
    `// Created idempotently by whichever adapter (display, touch, user I2C)`,
    `// runs first. All consumers call i2c_master_bus_add_device against the`,
    `// shared handle returned by __esp32_i2c_bus_get().`,
    `#include "driver/i2c_master.h"`,
    handleDecls,
    `static inline i2c_master_bus_handle_t __esp32_i2c_bus_get(uint8_t controller) {`,
    getterBodies,
    `  return NULL;  // unknown controller index`,
    `}`,
    ``,
  ].join('\n');
}

/**
 * Resolve a chip controller index to the host enum (for consumers that need
 * the i2c_port_t, e.g. for i2c_master_bus_reset).
 */
export function i2cHostForController(controllerIndex: number): string {
  const chip = getActiveChip();
  const cfg = chip.i2c.controllers[controllerIndex];
  if (!cfg) throw new Error(`I2C controller ${controllerIndex} not present on ${chip.id}`);
  return cfg.host;
}
