// Hand-maintained soc-keyed chip registry — mechanically migrated from the
// registry. chipForSoc() resolves a consolidated descriptor by the SoC name
// (the second segment of a Zephyr board target, or the config's soc: field).

import type { ZephyrChipDescriptor } from '../types.js';
import { ESP32_SOC } from './esp32.js';
import { ESP32C3_SOC } from './esp32c3.js';
import { ESP32C6_SOC } from './esp32c6.js';
import { ESP32S3_SOC } from './esp32s3.js';
import { SAMD21G18A_SOC } from './samd21g18a.js';
import { RP2040_SOC } from './rp2040.js';
import { RP2350A_SOC } from './rp2350a.js';
import { NRF52840_SOC } from './nrf52840.js';
import { STM32F411XE_SOC } from './stm32f411xe.js';

export const SOC_CHIPS: Readonly<Record<string, ZephyrChipDescriptor>> = {
  "esp32": ESP32_SOC,
  "esp32c3": ESP32C3_SOC,
  "esp32c6": ESP32C6_SOC,
  "esp32s3": ESP32S3_SOC,
  "samd21g18a": SAMD21G18A_SOC,
  "rp2040": RP2040_SOC,
  "rp2350a": RP2350A_SOC,
  "nrf52840": NRF52840_SOC,
  "stm32f411xe": STM32F411XE_SOC,
};
