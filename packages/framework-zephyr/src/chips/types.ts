// ---------------------------------------------------------------------------
// Zephyr chip descriptor — pure-data model
//
// Mirrors the per-framework chip-descriptor pattern established by
// framework-esp32 (Esp32ChipDescriptor) and framework-avr (AVRChipDescriptor):
// the framework owns its own device-tree-derived descriptor, keyed off the
// Zephyr board target string in frameworkData.buildTarget. The board/MCU
// packages are deliberately NOT read at emit time (see the framework-package
// data-flow split); this descriptor is the source the lowering reads.
//
// No behavior — the lowering code in src/lowering/*.ts reads getActiveChip()
// to resolve pins to devicetree specs and raw-controller fallbacks.
// ---------------------------------------------------------------------------

/**
 * A GPIO pin described as a devicetree spec.
 *
 * Zephyr addresses GPIO via `struct gpio_dt_spec` resolved from devicetree
 * aliases/labels (e.g. DT_ALIAS(led0)). The dtSpec form is preferred because
 * `gpio_pin_set_dt()` honors the node's polarity flags — so an active-low LED
 * (logical 1 = LED on) is handled by the DT `GPIO_ACTIVE_LOW` flag, not by the
 * generated C++.
 */
export interface ZephyrGpioDtSpec {
  /** GPIO number — matches the HAL op `pin` field (P0.X → X, P1.X → 32+X). */
  readonly pin: number;
  /**
   * Devicetree alias/nodelabel macro, e.g. `led0`, `sw0`, `led1`.
   * Emitted as `GPIO_DT_SPEC_GET(DT_ALIAS(<dtSpec>), gpios)`.
   */
  readonly dtSpec: string;
}

/**
 * A GPIO controller devicetree node, and the HAL pin-number range it owns.
 *
 * Most SoCs expose a single GPIO controller (nRF52840: `gpio0` owns every
 * pin). SoCs that split GPIO across multiple devicetree nodes — e.g. the
 * ESP32-S3 (`gpio0`: pins 0–31, `gpio1`: pins 32–48) — list one entry per
 * controller so the lowering can route a HAL pin to the owning controller at
 * runtime. Pin numbers match the HAL op `pin` field.
 */
export interface ZephyrGpioController {
  /** Devicetree nodelabel, e.g. 'gpio0', 'gpio1'. */
  readonly nodelabel: string;
  /** First HAL pin number owned by this controller (inclusive). */
  readonly minPin: number;
  /** Last HAL pin number owned by this controller (inclusive). */
  readonly maxPin: number;
}

/**
 * A bus controller (I2C / SPI / UART) described by its devicetree nodelabel.
 *
 * Zephyr resolves the `const struct device*` at compile time via
 * `DEVICE_DT_GET(DT_NODELABEL(<nodeLabel>))`, so unlike ESP-IDF there is no
 * lazy handle resolution — the lowering emits the macro directly.
 */
export interface ZephyrBusController {
  /** Devicetree nodelabel, e.g. 'i2c1', 'spi2', 'uart0'. */
  readonly nodeLabel: string;
}

/**
 * A PWM channel described as a devicetree spec.
 *
 * Emitted as `struct pwm_dt_spec __tc_pwm<N> = PWM_DT_SPEC_GET(DT_ALIAS(<dtSpec>))`.
 * `pwm_set_pulse_dt(&__tc_pwm<N>, pulse_ns)` honors the spec's period/polarity.
 */
export interface ZephyrPwmSpec {
  /** GPIO number (matches the HAL op `pin` field). */
  readonly pin: number;
  /** Devicetree alias, e.g. 'pwm-led0'. */
  readonly dtSpec: string;
}

/**
 * A GPIO pin usable as an interrupt source.
 *
 * Emitted as `struct gpio_dt_spec __tc_int<N> = GPIO_DT_SPEC_GET(DT_ALIAS(<dtSpec>), gpios)`
 * + a `struct gpio_callback` registered via `gpio_add_callback`.
 */
export interface ZephyrInterruptPin {
  /** GPIO number (matches the HAL op `pin` field). */
  readonly pin: number;
  /** Devicetree alias, e.g. 'sw0', or a nodelabel. */
  readonly dtSpec: string;
}

/**
 * An ADC channel: which SAADC input a given HAL pin maps to.
 *
 * The XIAO nRF52840 has no pre-declared ADC channel nodes in devicetree, so the
 * lowering emits `adc_channel_setup` against `DEVICE_DT_GET(DT_NODELABEL(adc))`
 * using the `channel` index here (SAADC AIN0–AIN7).
 */
export interface ZephyrAdcChannel {
  /** GPIO number (matches the HAL op `pin` field). */
  readonly pin: number;
  /** SAADC channel index (AIN0–AIN7). */
  readonly channel: number;
}

/**
 * Pure-data descriptor for a Zephyr board + its SoC's peripheral layout.
 */
export interface ZephyrChipDescriptor {
  /** Zephyr board target (the `west build -b <id>` argument), e.g. 'xiao_ble'. */
  readonly id: string;
  /** SoC family, e.g. 'nrf52840'. */
  readonly soc: string;
  /**
   * Default GPIO controller nodelabel for the raw-pin fallback. Pins not in
   * `gpio.dtSpecs` are addressed via
   * `DEVICE_DT_GET(DT_NODELABEL(<gpioController>))` + gpio_pin_*_raw().
   *
   * For SoCs that split GPIO across multiple devicetree nodes, `gpioControllers`
   * overrides this per pin range; this field is then only the out-of-range
   * fallback (so a single-controller board is unaffected by it).
   */
  readonly gpioController: string;
  /**
   * Per-range GPIO controllers for SoCs that split GPIO across multiple
   * devicetree nodes (ESP32-S3: `gpio0` 0–31, `gpio1` 32–48). When present, the
   * lowering routes a HAL pin to its owning controller at runtime via the
   * emitted `__tc_gpio_dev(pin)` dispatcher; `gpioController` is the fallback.
   * Omit on single-controller SoCs (nRF52840, RP2040, …) — every pin is on the
   * one controller described by `gpioController`.
   */
  readonly gpioControllers?: readonly ZephyrGpioController[];
  /** GPIO pins with devicetree specs (LEDs, buttons, board-defined pins). */
  readonly gpio: {
    readonly dtSpecs: readonly ZephyrGpioDtSpec[];
    /** Interrupt-capable pins with DT specs (buttons etc.). */
    readonly interruptPins?: readonly ZephyrInterruptPin[];
  };
  /** I2C controllers (board-wired). Index 0 = the primary bus. */
  readonly i2c?: { readonly controllers: readonly ZephyrBusController[] };
  /** SPI controllers (board-wired). Index 0 = the primary bus. */
  readonly spi?: { readonly controllers: readonly ZephyrBusController[] };
  /** UART controllers (board-wired). Index 0 = the primary port. */
  readonly uart?: { readonly controllers: readonly ZephyrBusController[] };
  /** PWM channels with DT specs. */
  readonly pwm?: { readonly specs: readonly ZephyrPwmSpec[] };
  /** ADC: the SAADC node label + the pin→channel map. */
  readonly adc?: {
    readonly nodeLabel: string;
    readonly channels: readonly ZephyrAdcChannel[];
    /** Reference voltage in millivolts (nRF internal = 3000 for VDD/4 + gain 1/4… use 3000). */
    readonly vrefMv: number;
    /** ADC resolution in bits. */
    readonly resolution: number;
  };
  /** Watchdog node label, e.g. 'wdt0'. */
  readonly wdt?: { readonly nodeLabel: string };
}

