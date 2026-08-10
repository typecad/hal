// ---------------------------------------------------------------------------
// @typecad/board-xiao-nrf52840 — Board definition manifest
//
// Seeed Studio XIAO nRF52840 — ultra-small BLE board. The onboard user LED
// (active-low) is the blink target for the Zephyr MVP demo.
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';
import { NRF52840 } from '@typecad/mcu-nrf52840';

// ---------------------------------------------------------------------------
// Board definition
// ---------------------------------------------------------------------------

export const XiaoNRF52840: BoardDefinition = {
  id: 'xiao-nrf52840',
  name: 'XIAO nRF52840',
  vendor: 'Seeed Studio',
  description: 'Seeed Studio XIAO nRF52840 — BLE + nRF52840 (Cortex-M4F)',

  mcu: NRF52840,
  clockSpeed: 64_000_000, // 64 MHz

  // ----- Pins --------------------------------------------------------------
  pins: {
    ...NRF52840.pins,
    // Board overlay: tag the LED (already onboardLed on the MCU, but keep the
    // board-level led: name for Board.definition.* access and the pin-tagging
    // convention used by other board packages).
    led: 'P0.26',
    button: 'P0.04',
  },

  // ----- Peripherals -------------------------------------------------------
  peripherals: {
    ...NRF52840.peripherals,
    aliases: {},
  },

  // ----- Build config ------------------------------------------------------
  build: {
    frameworks: {
      // The Zephyr board target for `west build -b <target>`.
      zephyr: 'xiao_ble',
    },
    defines: {},
  },

  // ----- @typecad/framework-zephyr chip data -------------------------------
  // Carried into the flattened board constants under `zephyr.*` and
  // reconstructed into a ZephyrChipDescriptor by framework-zephyr's
  // resolveChipFromBoard(). This is the source the GPIO lowering reads: pins
  // listed in gpio.dtSpecs lower through gpio_pin_*_dt() (honoring the DT
  // polarity flag, so the active-low LEDs are correct), while pins without a
  // dtSpec fall back to the raw gpio0 controller path.
  //
  // Plain object/array literals only — `as const` on nested values defeats the
  // board-constants flattener. Mirrors framework-zephyr's hardcoded XIAO_BLE
  // descriptor (src/chips/xiao-ble.ts), verified against xiao_ble_common.dtsi.
  zephyr: {
    gpioController: 'gpio0',
    gpio: {
      // Onboard RGB LEDs — active-low (GPIO_ACTIVE_LOW in xiao_ble_common.dtsi).
      dtSpecs: [
        { pin: 26, dtSpec: 'led0' },  // Red   (P0.26)
        { pin: 30, dtSpec: 'led1' },  // Green (P0.30)
        { pin: 6, dtSpec: 'led2' },   // Blue  (P0.06)
      ],
      // The XIAO nRF52840 user button is on P0.04, but mainline Zephyr's
      // xiao_ble board does NOT expose it as a `sw0` DT alias (no gpio-keys
      // node in Zephyr ≤4.3.99). Leaving interruptPins non-empty would emit
      // GPIO_DT_SPEC_GET(DT_ALIAS(sw0), gpios) and fail to compile. See the
      // matching note in framework-zephyr src/chips/xiao-ble.ts.
      interruptPins: [],
    },
    // XIAO connector wiring (seeed_xiao_connector.dtsi + xiao_ble-pinctrl.dtsi).
    i2c:  { controllers: [{ nodeLabel: 'i2c1' }] },
    spi:  { controllers: [{ nodeLabel: 'spi2' }] },
    uart: { controllers: [{ nodeLabel: 'uart0' }] },
    pwm: {
      // pwm-led0 drives the board PWM LED (PWM_OUT0 on P0.17, inverted).
      specs: [{ pin: 17, dtSpec: 'pwm-led0' }],
    },
    adc: {
      // SAADC node is `adc`; XIAO D0–D3 = AIN0–AIN3 (P0.02/P0.03/P0.28/P0.29).
      // Internal VREF ~0.6V with VDD/4 gain ⇒ 3000mV.
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
  },
};

export default XiaoNRF52840;

// ---------------------------------------------------------------------------
// Re-exports — convenience barrel
// ---------------------------------------------------------------------------

// Silicon-level re-exports from MCU package
export * from '@typecad/mcu-nrf52840';

// Generic HAL re-exports — full re-export so this board package is a superset
// of @typecad/hal (matches the board-esp32-devkit convention).
export * from '@typecad/hal';

// Board-level pin Discovery API (using silicon pins from MCU). These are
// imported aliased to avoid clashing with the `export * from './pins.js'`
// re-exports below (which re-export the same symbols under their board names).
import {
  D0 as MCU_D0, D1 as MCU_D1, D2 as MCU_D2, D3 as MCU_D3,
  D4 as MCU_D4, D5 as MCU_D5, D6 as MCU_D6, D7 as MCU_D7,
  D8 as MCU_D8, D9 as MCU_D9, D10 as MCU_D10,
  LED as MCU_LED, BUTTON as MCU_BUTTON,
} from '@typecad/mcu-nrf52840';

/**
 * Pin collections for runtime capability discovery.
 */
export const pins = {
  /** Digital I/O pins (XIAO D0–D10). */
  digital: [MCU_D0, MCU_D1, MCU_D2, MCU_D3, MCU_D4, MCU_D5, MCU_D6, MCU_D7, MCU_D8, MCU_D9, MCU_D10] as const,
  /** Analog input pins (SAADC on D0–D3). */
  analog: [MCU_D0, MCU_D1, MCU_D2, MCU_D3] as const,
  /** All XIAO GPIOs support edge interrupts. */
  interrupt: [MCU_D0, MCU_D1, MCU_D2, MCU_D3, MCU_D4, MCU_D5, MCU_D6, MCU_D7, MCU_D8, MCU_D9, MCU_D10] as const,
  /** Onboard user LED (active-low). */
  led: MCU_LED,
  /** Onboard user button. */
  button: MCU_BUTTON,
} as const;

/**
 * Peripheral-to-pin mapping for the XIAO nRF52840.
 * (I2C/SPI/UART lowering is not yet implemented in @typecad/framework-zephyr;
 * these mappings are recorded for future coverage.)
 */
export const PeripheralPins = {
  I2C0:  { SDA: 'P0.24', SCL: 'P0.25' } as const,
  SPI0:  { MOSI: 'P0.13', MISO: 'P0.14', SCK: 'P0.15' } as const,
  UART0: { TX: 'P0.06', RX: 'P1.02' } as const,
} as const;

// Board-level typed pins (D-aliases, LED, BUTTON)
export * from './pins.js';

// Board-specific analog constants
export * from './analog.js';

// Board namespace (single-import convenience)
export { Board } from './board.js';
