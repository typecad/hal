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
  // User buses, mirroring the devkit's verified facts (the
  // board-constants path is authoritative in real builds; this registry
  // entry is the fallback when board constants are absent — e.g. the
  // transpile test harness). uart1 (not uart0 — the console) with the
  // pinctrl group + current-speed the esp32-uart binding requires; i2c0;
  // spi2/spi3.
  i2c: { controllers: [{ nodeLabel: 'i2c0' }] },
  spi: { controllers: [{ nodeLabel: 'spi2' }, { nodeLabel: 'spi3' }] },
  uart: {
    controllers: [
      {
        nodeLabel: 'uart1',
        pinctrlRef: 'uart1_default',
        props: ['current-speed = <115200>;'],
      },
    ],
  },
  // USB CDC-ACM over the S3's native USB-OTG (D-/D+ on the dedicated GPIO19/20
  // pads, no GPIO matrix). The board DTS already aliases the DWC2 controller
  // node and enables it (`zephyr_udc0: &usb_otg { status = "okay"; }` —
  // esp32s3_devkitc_procpu.dts), and the UDC DWC2 driver is DT-default-on, so
  // declaring it here is all usb.* needs: the overlay composes one CDC-ACM
  // instance child and the kconfig resolver enables the "next" USB stack.
  // Console stays on uart0 (the devkit's USB-serial bridge) unless
  // `console.output: 'usb'` rebinds zephyr,console to the CDC port.
  usb: { controller: 'zephyr_udc0', cdcInstances: 1, vid: '0x2FE3', pid: '0x0006' },
  // PWM: the LEDC controller (ledc0 in esp32s3_common.dtsi) — 8 channels, each
  // routable to nearly any pad through the GPIO matrix, so this is a matrix
  // (channels assigned to the driven pins at build time), not a static spec
  // list. Pin selection excludes: GPIO0 (boot strap / BOOT button), GPIO19/20
  // (USB D-/D+), GPIO26–32 (SPI flash/PSRAM), GPIO33–37 (octal PSRAM on OPI
  // modules), GPIO43/44 (uart0 console pads). The driver
  // (CONFIG_PWM_LED_ESP32, DT-default-on) requires a pinctrl group routing
  // each used channel (LEDC_CH<ch>_GPIO<pin> pinmux tokens, all 8×46 pairs in
  // esp32s3-pinctrl.h) plus per-channel child nodes (reg + timer) — both
  // emitted by the overlay generator (dt-config/overlay.ts emitPwmNodes).
  pwm: {
    specs: [],
    matrix: {
      controller: 'ledc0',
      channelCount: 8,
      pins: [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
        21,
        38, 39, 40, 41, 42,
        45, 46, 47, 48,
      ],
    },
  },
};
