// ---------------------------------------------------------------------------
// @typecad/board-blackpill-f411ce — Board definition manifest
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';
import { STM32F411 } from '@typecad/mcu-stm32f411';

// ---------------------------------------------------------------------------
// Board definition
// ---------------------------------------------------------------------------

export const BlackPillF411CEBoard: BoardDefinition = {
  id: 'blackpill-f411ce',
  name: 'Black Pill (STM32F411)',
  vendor: 'WeAct Studio',
  description:
    'WeAct Studio Black Pill V2.0 (STM32F411CEU6 module). Single-core ARM ' +
    'Cortex-M4F; the board DTS clocks it at 96 MHz (HSE 25 MHz crystal → PLL, ' +
    'chosen for a stable 48 MHz USB clock). 512 KB flash, 128 KB SRAM, 34 GPIO. ' +
    'No wireless. Onboard user LED (PC13, active-low) and KEY button (PA0). ' +
    'Flashable over USB via the factory ROM DFU bootloader (BOOT0 + reset).',

  mcu: STM32F411,
  // 96 MHz, not the 100 MHz silicon max — Zephyr's blackpill_f411ce DTS
  // derives sysclk from the 25 MHz HSE (25/25×192/2) so PLLQ yields exactly
  // 48 MHz for the USB OTG_FS peripheral.
  clockSpeed: 96_000_000,

  // ----- Memory (module-level defaults; silicon memory lives on the MCU) ---
  memory: {
    flash: 512 * 1024,
  },

  // ----- Pins --------------------------------------------------------------
  pins: {
    ...STM32F411.pins,
    // Board overlay: the Black Pill onboard LED is on PC13 (active-low) and
    // the KEY button on PA0 (active-low + pull-up).
    led: 'PC13',
    button: 'PA0',
  },

  // ----- Peripherals -------------------------------------------------------
  peripherals: {
    ...STM32F411.peripherals,
    aliases: {
      UART0: 'Serial',
      I2C0:  'Wire',
      SPI0:  'SPI',
    },
  },

  // ----- Build config ------------------------------------------------------
  build: {
    frameworks: {
      // The Zephyr board target for `west build -b <target>`. Qualified form
      // (board/soc) — the bare id is also accepted on this single-variant
      // board, but every catalog-provided target is kept qualified for
      // consistency (verified against Zephyr 4.3
      // boards/weact/blackpill_f411ce/board.yml).
      zephyr: 'blackpill_f411ce/stm32f411xe',
    },
    defines: {},
  },

  // ----- @typecad/framework-zephyr chip data -------------------------------
  // Carried into the flattened board constants under `zephyr.*` and
  // reconstructed into a ZephyrChipDescriptor by framework-zephyr's
  // resolveChipFromBoard(). Verified against Zephyr 4.3's
  // boards/weact/blackpill_f411ce/blackpill_f411ce.dts, the SoC dtsi chain
  // (stm32f411.dtsi → stm32f401.dtsi → stm32f4.dtsi), and the board pinctrl
  // dtsi. Pin numbers use the port-block scheme (PA<bit> → bit, PB<bit> →
  // 16+bit, PC<bit> → 32+bit).
  //
  // Plain object/array literals only — `as const` on nested values defeats the
  // board-constants flattener.
  zephyr: {
    // GPIO is split across THREE devicetree controllers — one per port — so
    // the runtime pin→controller routing is carried here (a compile-time DT
    // macro cannot reach it), same shape as the ESP32's gpio0/gpio1 split.
    gpioController: 'gpioa',
    gpioControllers: [
      { nodelabel: 'gpioa', minPin: 0, maxPin: 15 },
      { nodelabel: 'gpiob', minPin: 16, maxPin: 31 },
      { nodelabel: 'gpioc', minPin: 32, maxPin: 47 },
    ],
    gpio: {
      // The board's only DT-aliased GPIOs, listed so a program driving the
      // onboard LED or reading the KEY button goes through the polarity-
      // correct devicetree-spec path (GPIO_ACTIVE_LOW honored by the DT
      // flags). Every other pin uses the raw-controller path against its
      // owning port controller.
      dtSpecs: [
        { pin: 45, dtSpec: 'led0' },  // User LED (PC13, active-low)
        { pin: 0,  dtSpec: 'sw0' },   // KEY button (PA0, active-low + pull-up)
      ],
      interruptPins: [
        { pin: 0, dtSpec: 'sw0' },    // KEY button (PA0)
      ],
    },
    // Board-wired default-enabled controllers (blackpill_f411ce.dts):
    //   usart1 = console @115200 (PA9/PA10), i2c1 (PB8/PB9, fast mode),
    //   spi1 (PA4–PA7).
    i2c:  { controllers: [{ nodeLabel: 'i2c1' }] },
    spi:  { controllers: [{ nodeLabel: 'spi1' }] },
    uart: { controllers: [{ nodeLabel: 'usart1' }] },
    // The STM32 watchdog node is `iwdg` (independent watchdog), NOT the
    // `wdt0` the lowering defaults to — declared explicitly so wdt.* ops
    // resolve to the right DEVICE_DT_GET(DT_NODELABEL(iwdg)).
    wdt: { nodeLabel: 'iwdg' },
    // PWM: the board DTS enables `pwm4` (TIM4 ch1/ch2 on PB6/PB7, the
    // `pwm` child of &timers4) but defines no DT alias for it — hence the
    // synthesized form (controller + channel). The overlay generator creates
    // a pwm-leds consumer + `tc-pwm<pin>` alias; the lowering emits
    // PWM_DT_SPEC_GET(DT_ALIAS(tc-pwm<pin>)). 20 ms period (50 Hz servo
    // convention); duty is scaled 0–255 against it.
    pwm: {
      specs: [
        { pin: 22, controller: 'pwm4', channel: 1, periodNs: 20_000_000 },  // PB6 (TIM4_CH1)
        { pin: 23, controller: 'pwm4', channel: 2, periodNs: 20_000_000 },  // PB7 (TIM4_CH2)
      ],
    },
    // ADC1: 12-bit, 10 external channels reach bonded pins (IN0–IN9 = PA0–PA7,
    // PB0/PB1; IN10–IN15 route to unbonded PC0–PC5). The STM32 driver requires
    // exactly ADC_GAIN_1 + ADC_REF_INTERNAL (Zephyr maps "internal" to the
    // VREF+ pad = VDDA); vref-mv defaults to 3300 in the st,stm32-adc binding.
    // `pinctrl` labels (adc1_in<N>_<pin>) let the overlay mux exactly the read
    // channels' pads to analog — the board DTS's pinctrl-0 covers only PA1.
    adc: {
      nodeLabel: 'adc1',
      resolution: 12,
      vrefMv: 3300,
      gain: 'ADC_GAIN_1',
      reference: 'ADC_REF_INTERNAL',
      channels: [
        { pin:  0, channel: 0, pinctrl: 'adc1_in0_pa0' },
        { pin:  1, channel: 1, pinctrl: 'adc1_in1_pa1' },
        { pin:  2, channel: 2, pinctrl: 'adc1_in2_pa2' },
        { pin:  3, channel: 3, pinctrl: 'adc1_in3_pa3' },
        { pin:  4, channel: 4, pinctrl: 'adc1_in4_pa4' },
        { pin:  5, channel: 5, pinctrl: 'adc1_in5_pa5' },
        { pin:  6, channel: 6, pinctrl: 'adc1_in6_pa6' },
        { pin:  7, channel: 7, pinctrl: 'adc1_in7_pa7' },
        { pin: 16, channel: 8, pinctrl: 'adc1_in8_pb0' },
        { pin: 17, channel: 9, pinctrl: 'adc1_in9_pb1' },
      ],
    },
    // NOTE: no wifi — radioless target (omission is the "no WiFi" signal).
  },
};

export default BlackPillF411CEBoard;

// ---------------------------------------------------------------------------
// Re-exports — convenience barrel
// ---------------------------------------------------------------------------

// Silicon-level
export * from '@typecad/mcu-stm32f411';

// Generic HAL re-exports from @typecad/hal. Full re-export so this board package
// is a superset of @typecad/hal — `import { ... } from '@typecad/hal'` resolves
// here at transpile time and exposes every HAL symbol plus board-specific pins.
export * from '@typecad/hal';

// Board-level pin Discovery API (uses silicon pins from MCU)
import {
  PA0, PA1, PA2, PA3, PA4, PA5, PA6, PA7,
  PA8, PA9, PA10, PA11, PA12, PA13, PA14, PA15,
  PB0, PB1, PB2, PB3, PB4, PB5, PB6, PB7,
  PB8, PB9, PB10, PB12, PB13, PB14, PB15,
  PC13, PC14, PC15,
} from '@typecad/mcu-stm32f411';

/**
 * Pin collections for runtime capability discovery.
 */
export const pins = {
  /** PWM-capable pins (any timer-channel pin; TIM4 ch1/ch2 on PB6/PB7 are the
   *  board-DTS-enabled `pwm4` channels). */
  pwm: [PA0, PA1, PA2, PA3, PA5, PA6, PA7, PA8, PA15,
        PB0, PB1, PB3, PB4, PB5, PB6, PB7, PB8, PB9,
        PB10, PB13, PB14, PB15] as const,
  /** Analog input pins (ADC1 IN0–IN9: PA0–PA7, PB0/PB1). */
  analog: [PA0, PA1, PA2, PA3, PA4, PA5, PA6, PA7, PB0, PB1] as const,
  /** All GPIOs support interrupts on STM32F411. */
  interrupt: [PA0, PA1, PA2, PA3, PA4, PA5, PA6, PA7,
              PA8, PA9, PA10, PA11, PA12, PA13, PA14, PA15,
              PB0, PB1, PB2, PB3, PB4, PB5, PB6, PB7,
              PB8, PB9, PB10, PB12, PB13, PB14, PB15,
              PC13, PC14, PC15] as const,
  /** All digital I/O pins. */
  digital: [PA0, PA1, PA2, PA3, PA4, PA5, PA6, PA7,
            PA8, PA9, PA10, PA11, PA12, PA13, PA14, PA15,
            PB0, PB1, PB2, PB3, PB4, PB5, PB6, PB7,
            PB8, PB9, PB10, PB12, PB13, PB14, PB15,
            PC13, PC14, PC15] as const,
} as const;

/**
 * Peripheral-to-pin mapping for the Black Pill (board default wiring —
 * matches the Zephyr board DTS's default-enabled controllers).
 */
export const PeripheralPins = {
  /** I2C bus 1 — PB9 (SDA) / PB8 (SCL). */
  I2C0: { SDA: 'PB9', SCL: 'PB8' } as const,
  /** SPI bus 1 — PA7 (MOSI), PA6 (MISO), PA5 (SCK). PA4 is default CS. */
  SPI0: { MOSI: 'PA7', MISO: 'PA6', SCK: 'PA5', CS: 'PA4' } as const,
  /** UART 1 — PA9 (TX) / PA10 (RX); console + USB-CDC serial available. */
  UART0: { TX: 'PA9', RX: 'PA10' } as const,
} as const;

// Board-level typed pins (LED/BUTTON + A0–A9 analog aliases)
export * from './pins.js';

// Board-specific analog constants
export * from './analog.js';

// Board namespace (single-import convenience)
export { Board } from './board.js';
