// ---------------------------------------------------------------------------
// Seeed Studio XIAO nRF52840 — Zephyr board descriptor
//
// Board target: `xiao_ble` (mainline Zephyr, boards/seeed/xiao_ble).
// The onboard user LED is active-low and exposed as the DT alias `led0`.
// ---------------------------------------------------------------------------

import type { ZephyrChipDescriptor } from './types.js';

export const XIAO_BLE: ZephyrChipDescriptor = {
  id: 'xiao_ble',
  soc: 'nrf52840',
  gpioController: 'gpio0',
  gpio: {
    dtSpecs: [
      // Onboard RGB LEDs — active-low (GPIO_ACTIVE_LOW in xiao_ble_common.dtsi).
      // Verified against the board's `aliases { led0 = &led0; led1 = &led1; led2 = &led2; }`.
      { pin: 26, dtSpec: 'led0' },  // Red   (P0.26)
      { pin: 30, dtSpec: 'led1' },  // Green (P0.30)
      { pin: 6, dtSpec: 'led2' },   // Blue  (P0.06)
    ],
    // User button — the XIAO nRF52840 exposes the user button as DT alias
    // `sw0` (P0.04), active-low with a pull-up enabled in the board DTS. The
    // @typecad/board package's BUTTON pin resolves to Pin(4) == P0.04. Without
    // this entry every interrupt.attach emitted only a comment (bug B2):
    // interrupts were declared supported but wired to nothing.
    interruptPins: [
      { pin: 4, dtSpec: 'sw0' },  // User button (P0.04)
    ],
  },
  // The XIAO connector wiring (from seeed_xiao_connector.dtsi + xiao_ble-pinctrl.dtsi):
  //   xiao_i2c     → i2c1  (SDA P0.04/D4, SCL P0.05/D5)
  //   xiao_spi     → spi2  (SCK P1.13/D8, MOSI P1.15/D10, MISO P1.14/D9)
  //   xiao_serial  → uart0 (TX P1.11/D6, RX P1.12/D7)
  // The board DTS leaves i2c0/spi0/spi1 disabled (shared instances).
  i2c: {
    controllers: [{ nodeLabel: 'i2c1' }],
  },
  spi: {
    controllers: [{ nodeLabel: 'spi2' }],
  },
  uart: {
    controllers: [{ nodeLabel: 'uart0' }],
  },
  pwm: {
    // pwm-led0 drives the board PWM LED (PWM_OUT0 on P0.17, inverted).
    specs: [{ pin: 17, dtSpec: 'pwm-led0' }],
  },
  adc: {
    // SAADC node is `adc`; no pre-declared channels. XIAO D0–D3 = AIN0–AIN3
    // (P0.02/P0.03/P0.28/P0.29). Internal VREF ~0.6V with VDD/4 gain ⇒ 3000mV.
    nodeLabel: 'adc',
    resolution: 12,
    vrefMv: 3000,
    channels: [
      { pin: 2, channel: 0 },   // P0.02 / D0 / AIN0
      { pin: 3, channel: 1 },   // P0.03 / D1 / AIN1
      { pin: 28, channel: 2 },  // P0.28 / D2 / AIN2
      { pin: 29, channel: 3 },  // P0.29 / D3 / AIN3
    ],
  },
  wdt: { nodeLabel: 'wdt0' },
};
