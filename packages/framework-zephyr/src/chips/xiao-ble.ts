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
    // GPIO is split across two devicetree controllers: gpio0 (P0.00–P0.31)
    // and gpio1 (P1.00–P1.15, HAL pins 32–47). Declaring the split makes the
    // raw path emit the port-relative index against gpio1 (P1.11 = raw 11),
    // which NRF_GPIO_PIN_MAP(1, 11) resolves to absolute pin 43 — the same
    // physical pin the old single-controller form reached only by accident:
    // gpio0 + global 43 also maps to 43 (MAP(0, 43) = 43), but that form
    // trips the generic layer's port_pin_mask __ASSERT ("Unsupported pin",
    // gpio0's mask covers 0–31) on any assert-enabled build.
  gpioControllers: [
    { nodelabel: 'gpio0', minPin: 0, maxPin: 31 },
    { nodelabel: 'gpio1', minPin: 32, maxPin: 47 },
  ],
  gpio: {
    dtSpecs: [
      // Onboard RGB LEDs — active-low (GPIO_ACTIVE_LOW in xiao_ble_common.dtsi).
      // Verified against the board's `aliases { led0 = &led0; led1 = &led1; led2 = &led2; }`.
      { pin: 26, dtSpec: 'led0' },  // Red   (P0.26)
      { pin: 30, dtSpec: 'led1' },  // Green (P0.30)
      { pin: 6, dtSpec: 'led2' },   // Blue  (P0.06)
    ],
    // The XIAO nRF52840 has a user button on P0.04, but mainline Zephyr's
    // xiao_ble board (verified against Zephyr 4.3.99) does NOT expose it as a
    // DT `sw0` alias — there is no gpio-keys node in xiao_ble.dts. Emitting
    // GPIO_DT_SPEC_GET(DT_ALIAS(sw0), gpios) therefore fails to compile
    // ('DT_N_ALIAS_sw0_... was not declared'). Until a button node + alias is
    // added (via an overlay or an upstream board update), interruptPins stays
    // empty: attachInterrupt on this board lowers to the no-DT-spec comment
    // fallback rather than a hard compile error.
    interruptPins: [],
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
  // Hardware timer: nRF RTC1 is the free counter (RTC0 is kernel-owned by the
  // softdevice/clock driver). The hwtimer lowering drives it as a Zephyr
  // counter device (counter_start/stop + a top-value alarm for set_frequency).
  // Verified against the nRF52840 SoC dtsi (rtc0/rtc1 nodes). The kernel uses
  // RTC0 for the system tick; RTC1 is available for application use.
  hwtimer: { controllers: [{ nodeLabel: 'rtc1' }] },
};
