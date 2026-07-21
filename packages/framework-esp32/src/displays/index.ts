// Barrel for ESP32 native display adapters.
//
// Drives panels through spi_device_polling_transmit (TFTs) or
// i2c_master_transmit (SSD1309) from the existing lowering files. No Adafruit,
// no Arduino-ESP32 dependency.
//
// SSD1680/e-ink is intentionally not supported — see strategy.ts
// resolveDisplayAdapter for the rationale.

export { esp32Ili9341Adapter } from "./ili9341-esp32.js";
export { esp32St7796Adapter } from "./st7796-esp32.js";
export { esp32Ssd1309Adapter } from "./ssd1309-esp32.js";
