import type { ArchitectureIdentifier } from "@typehal/core";

export const ARCH_DEFAULTS: Record<ArchitectureIdentifier, {
  mcu: string;
  clockSpeedMhz: number;
  flashKb: number;
  sramKb: number;
  eepromKb: number;
  vcc: number;
}> = {
  avr: { mcu: "ATmega328P", clockSpeedMhz: 16, flashKb: 32, sramKb: 2, eepromKb: 1, vcc: 5.0 },
  esp32: { mcu: "ESP32", clockSpeedMhz: 240, flashKb: 4096, sramKb: 520, eepromKb: 0, vcc: 3.3 },
  esp32s2: { mcu: "ESP32-S2", clockSpeedMhz: 240, flashKb: 4096, sramKb: 320, eepromKb: 0, vcc: 3.3 },
  esp32s3: { mcu: "ESP32-S3", clockSpeedMhz: 240, flashKb: 8192, sramKb: 512, eepromKb: 0, vcc: 3.3 },
  esp32c3: { mcu: "ESP32-C3", clockSpeedMhz: 160, flashKb: 4096, sramKb: 400, eepromKb: 0, vcc: 3.3 },
  rp2040: { mcu: "RP2040", clockSpeedMhz: 133, flashKb: 2048, sramKb: 264, eepromKb: 0, vcc: 3.3 },
  samd: { mcu: "SAMD21G18A", clockSpeedMhz: 48, flashKb: 256, sramKb: 32, eepromKb: 0, vcc: 3.3 },
  stm32: { mcu: "STM32F103C8", clockSpeedMhz: 72, flashKb: 64, sramKb: 20, eepromKb: 0, vcc: 3.3 },
  nrf52: { mcu: "nRF52840", clockSpeedMhz: 64, flashKb: 1024, sramKb: 256, eepromKb: 0, vcc: 3.3 },
};
