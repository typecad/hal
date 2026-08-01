// ---------------------------------------------------------------------------
// Espressif ESP32-S3 (esp32s3_devkitc) — Zephyr board descriptor
//
// Board target: `esp32s3_devkitc` (mainline Zephyr,
// boards/espressif/esp32s3_devkitc). Programmed over USB via the esptool
// runner (see toolchain/index.ts), unlike the J-Link/nrfjprog path used for
// the XIAO nRF52840.
//
// GPIO is split across TWO devicetree controllers — `gpio0` (pins 0–31) and
// `gpio1` (pins 32–48) — so this descriptor lists both in `gpioControllers`.
// The lowering routes each HAL pin to its owning controller at runtime; see
// chips/controllers.ts.
//
// Minimal-by-design: the only DT facts carried here are the ones a
// compile-time DT macro cannot reach — the runtime pin→controller split, plus
// the `sw0` alias for the BOOT button (used by the devicetree-spec GPIO path).
// Every other DT fact (UART/I2C/SPI/`wdt` nodelabels) is resolved by Zephyr's
// own devicetree via emitted DT_NODELABEL macros, not hand-copied here.
//
// Verified against the Zephyr board DTS:
//   boards/espressif/esp32s3_devkitc/esp32s3_devkitc_procpu.dts
//   aliases { sw0 = &button0; } → button_0: pin 0 on gpio0, active-low + pull-up
//   (the DevKitC board DTS defines no led0 alias — the onboard RGB is a WS2812
//   on GPIO38, not a plain GPIO LED, so it is intentionally NOT listed here.)
// ---------------------------------------------------------------------------

import type { ZephyrChipDescriptor } from './types.js';

export const ESP32S3_DEVKITC: ZephyrChipDescriptor = {
  id: 'esp32s3_devkitc',
  soc: 'esp32s3',
  gpioController: 'gpio0',
  gpioControllers: [
    { nodelabel: 'gpio0', minPin: 0, maxPin: 31 },
    { nodelabel: 'gpio1', minPin: 32, maxPin: 48 },
  ],
  gpio: {
    // The BOOT button (GPIO0) is the board's only DT-aliased GPIO. Listed so a
    // program reading/interrupting pin 0 goes through the polarity-correct
    // devicetree-spec path (GPIO_ACTIVE_LOW honored by the DT flags). Every
    // other GPIO pin uses the raw-controller path against its owning controller.
    dtSpecs: [
      { pin: 0, dtSpec: 'sw0' },  // BOOT button (GPIO0)
    ],
    interruptPins: [
      { pin: 0, dtSpec: 'sw0' },  // BOOT button (GPIO0)
    ],
  },
  // UART/I2C/SPI/`wdt` are intentionally omitted: their devicetree nodelabels
  // (uart0/uart1/uart2, i2c0/i2c1, spi2/spi3, wdt0) are resolved by Zephyr's
  // devicetree at compile time and don't need to be carried as data here. ADC is
  // omitted as well — added when a demo needs analog reads, with the verified
  // ESP32-S3 ADC1/ADC2 pin→channel map.
  // WiFi: the ESP32-S3 has a 2.4GHz radio; conn_mgr + the esp32 wifi driver
  // (CONFIG_WIFI_ESP32) provide connectivity. Omitted on radioless targets.
  wifi: { supported: true },
};
