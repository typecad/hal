// ---------------------------------------------------------------------------
// Espressif ESP32 (esp32_devkitc) — Zephyr board descriptor
//
// Board target: `esp32_devkitc` (mainline Zephyr,
// boards/espressif/esp32_devkitc). Programmed over USB via the esptool runner
// (see toolchain/index.ts), the same flash path as the ESP32-S3.
//
// GPIO is split across TWO devicetree controllers — `gpio0` (pins 0–31) and
// `gpio1` (pins 32–39) — so this descriptor lists both in `gpioControllers`.
// The lowering routes each HAL pin to its owning controller at runtime; see
// chips/controllers.ts. (Same shape as the S3, but the ESP32's highest GPIO is
// 39, not 48 — `gpio1` has ngpios=8, not 17.)
//
// Minimal-by-design: the only DT facts carried here are the ones a compile-time
// DT macro cannot reach — the runtime pin→controller split, plus the `sw0`
// alias for the BOOT button (used by the devicetree-spec GPIO path). Every other
// DT fact (UART/I2C/SPI/`wdt` nodelabels) is resolved by Zephyr's own
// devicetree via emitted DT_NODELABEL macros, not hand-copied here.
//
// Verified against the Zephyr board DTS:
//   boards/espressif/esp32_devkitc/esp32_devkitc_procpu.dts
//   aliases { sw0 = &button0; } → button_0: pin 0 on gpio0, active-low + pull-up
//   &gpio0/&gpio1 { status = "okay" }   (esp32_devkitc_procpu.dts:64-70)
//   &wifi { status = "okay" }            (esp32_devkitc_procpu.dts:143-145)
// GPIO controller coverage:
//   dts/xtensa/espressif/esp32/esp32_common.dtsi:314-337
//   gpio0: ngpios = <32>  (pins 0–31)
//   gpio1: ngpios = <8>   (pins 32–39)
//
// Note: GPIO 34–39 are input-only pads on ESP32 silicon (not modeled here —
// the DT does not encode output restrictions per pin; an output config on those
// pins fails at runtime against the raw controller, which is the expected
// silicon-accurate behavior).
// ---------------------------------------------------------------------------

import type { ZephyrChipDescriptor } from './types.js';

export const ESP32_DEVKITC: ZephyrChipDescriptor = {
  id: 'esp32_devkitc',
  soc: 'esp32',
  gpioController: 'gpio0',
  gpioControllers: [
    { nodelabel: 'gpio0', minPin: 0, maxPin: 31 },
    { nodelabel: 'gpio1', minPin: 32, maxPin: 39 },
  ],
  gpio: {
    // The BOOT button (GPIO0) is the board's only DT-aliased GPIO. Listed so a
    // program reading/interrupting pin 0 goes through the polarity-correct
    // devicetree-spec path (GPIO_ACTIVE_LOW honored by the DT flags).
    dtSpecs: [
      { pin: 0, dtSpec: 'sw0' },  // BOOT button (GPIO0)
    ],
    interruptPins: [
      { pin: 0, dtSpec: 'sw0' },  // BOOT button (GPIO0)
    ],
  },
  // WiFi: the ESP32 has a 2.4GHz radio; conn_mgr + the esp32 wifi driver
  // (CONFIG_WIFI_ESP32) provide connectivity. WIFI_ESP32 depends on !SMP, and
  // the ESP32 is AMP (dual-image procpu/appcpu), not SMP, by default — so the
  // dependency is satisfied. Omitted on radioless targets.
  wifi: { supported: true },
  // DAC: the ESP32 has two 8-bit DAC channels on GPIO25 (channel 1) and GPIO26
  // (channel 2). The Zephyr esp32 DAC driver (drivers/dac/dac_esp32.c) exposes
  // them via the `dac0` node; the lowering emits dac_channel_setup +
  // dac_write_value against DEVICE_DT_GET(DT_NODELABEL(dac0)). The overlay
  // enables the node when the program uses dac.*. ESP32-S3 has no DAC.
  dac: {
    device: 'dac0',
    channels: [
      { pin: 25, channel: 1, resolution: 8 },
      { pin: 26, channel: 2, resolution: 8 },
    ],
  },
};
