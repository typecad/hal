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
 * Two forms, mutually exclusive:
 * - **Board-shipped alias:** `dtSpec` names a DT alias the board's own DTS
 *   already defines (e.g. the XIAO's `pwm-led0`). Emitted as
 *   `PWM_DT_SPEC_GET(DT_ALIAS(<dtSpec>))`.
 * - **Synthesized** (controller + channel): the board DTS enables a PWM
 *   controller node (e.g. `pwm4`) but defines no alias for it. The overlay
 *   generator synthesizes a `pwm-leds` consumer node + a `tc-pwm<pin>` alias
 *   in `<board>.overlay`; the lowering emits
 *   `PWM_DT_SPEC_GET(DT_ALIAS(tc-pwm<pin>))`. Both sides derive the alias
 *   name from the pin, so they always agree.
 *
 * `pwm_set_pulse_dt(&spec, pulse_ns)` honors the spec's period/polarity.
 */
export interface ZephyrPwmSpec {
  /** GPIO number (matches the HAL op `pin` field). */
  readonly pin: number;
  /** Board-shipped DT alias, e.g. 'pwm-led0'. Omit when using the
   *  synthesized form (controller + channel). */
  readonly dtSpec?: string;
  /** Synthesized form: PWM controller DT nodelabel, e.g. 'pwm4' (the STM32
   *  timer's pwm child node). The overlay's pwm-leds node consumes it. */
  readonly controller?: string;
  /** Synthesized form: channel index within the controller (1-based timer
   *  channel, matching the `pwms` binding's channel cell). */
  readonly channel?: number;
  /** Synthesized form: period in nanoseconds, baked into the DT spec. The
   *  lowering scales duty against `spec.period`. Default 20 000 000 (20 ms /
   *  50 Hz — the servo convention; harmless for LED dimming). */
  readonly periodNs?: number;
  /** Synthesized form: PWM polarity flag. Default PWM_POLARITY_NORMAL. */
  readonly polarity?: string;
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
 * An ADC channel: which ADC input a given HAL pin maps to.
 *
 * The XIAO nRF52840 has no pre-declared ADC channel nodes in devicetree, so the
 * lowering emits `adc_channel_setup` against `DEVICE_DT_GET(DT_NODELABEL(adc))`
 * using the `channel` index here (SAADC AIN0–AIN7).
 */
export interface ZephyrAdcChannel {
  /** GPIO number (matches the HAL op `pin` field). */
  readonly pin: number;
  /** ADC channel index (nRF SAADC AIN0–AIN7; STM32 ADC1_IN0–IN9). */
  readonly channel: number;
  /**
   * Pinctrl node label that muxes this pin to analog mode, e.g.
   * 'adc1_in0_pa0' (STM32). When present, the overlay generator rewrites the
   * ADC node's pinctrl-0 to the channels the program actually reads — SoCs
   * like STM32 leave the pad in GPIO mode otherwise and reads float.
   * Omit on SoCs whose ADC needs no pad muxing (nRF SAADC, RP2040).
   */
  readonly pinctrl?: string;
}

/**
 * A DAC channel: which DAC output a given HAL pin maps to. The lowering emits
 * `dac_channel_setup` + `dac_write_value` against the DAC device node.
 */
export interface ZephyrDacChannel {
  /** GPIO number (matches the HAL op `pin` field). */
  readonly pin: number;
  /** DAC channel index (ESP32: GPIO25 → 1, GPIO26 → 2). */
  readonly channel: number;
  /** DAC resolution in bits (ESP32 DAC is 8-bit). */
  readonly resolution: number;
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
   * devicetree nodes (ESP32-S3: `gpio0` 0–31, `gpio1` 32–48; STM32: one
   * controller per port — `gpioa` 0–15, `gpiob` 16–31, `gpioc` 32–47).
   * When present, the lowering routes a HAL pin to its owning controller at
   * runtime via the emitted `__tc_gpio_dev(pin)` dispatcher; `gpioController`
   * is the fallback. Omit on single-controller SoCs (RP2040, …) — every pin
   * is on the one controller described by `gpioController`.
   *
   * NUMBERING RULE (load-bearing): `minPin` must equal the controller's port
   * base so the port-relative raw index is `pin - minPin` (STM32 PB12 = pin
   * 28 → raw 12 — the Zephyr raw API addresses the index WITHIN the
   * controller). Number pins by port blocks and never contiguously across
   * unbonded pins.
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
  /**
   * USB device (CDC-ACM serial) capability. Zephyr "next" USB device stack:
   * the UDC controller node (uniformly `zephyr_udc0` on every USB-capable
   * board) plus `cdcInstances` CDC-ACM class child nodes, both composed in
   * the generated overlay. The lowering addresses instance N as
   * DT_NODELABEL(cdc_acm_uart<N>) — a UART-class device driven with the
   * plain uart_* API. Boards without USB device support omit this field;
   * usb.* HAL ops then fail with a clear "board does not expose USB" error.
   */
  readonly usb?: {
    /** UDC controller nodelabel (convention: 'zephyr_udc0'). */
    readonly controller: string;
    /** How many CDC-ACM serial instances to compose (≥1). */
    readonly cdcInstances: number;
    /** USB vendor ID for the device descriptor ('0x2fe3' Zephyr-test default). */
    readonly vid?: string;
    /** USB product ID for the device descriptor ('0x0001' default). */
    readonly pid?: string;
  };
  /** PWM channels with DT specs. */
  readonly pwm?: {
    readonly specs: readonly ZephyrPwmSpec[];
    /**
     * Timer input clock (Hz) for the synthesized specs' controllers — the
     * number the 16-bit overflow check divides by (STM32: APB clock × the
     * timer multiplier; blackpill TIM4 = 96 MHz). When set, the overlay
     * generator derives an `st,prescaler` for the timers node so slow
     * periods (servo 20 ms) fit the 16-bit ARR — without it pwm_stm32
     * rejects the channel ("period cycles exceeds 16-bit timer limit").
     */
    readonly clockHz?: number;
    /**
     * The PWM capability constants the transpiler constant-folds
     * getPwmFrequency()/getPwmResolution() to (from the MCU manifest's
     * peripherals.pwm.maxFrequency/resolution). The runtime lowering returns
     * the SAME numbers so a folded literal and a runtime call never disagree.
     * When absent, the lowering falls back to 1e9/period and the 8-bit
     * Arduino duty range.
     */
    readonly maxFrequencyHz?: number;
    readonly resolutionBits?: number;
  };
  /**
   * Human-readable description of where the board's default console goes
   * (its devicetree `zephyr,console` node), e.g. "usart1 on PA9 (TX) /
   * PA10 (RX)". Shown in the build note when a program uses console.log,
   * so the output's destination is not tribal knowledge.
   */
  readonly consoleDescription?: string;
  /** ADC: the ADC device node label + the pin→channel map. */
  readonly adc?: {
    readonly nodeLabel: string;
    readonly channels: readonly ZephyrAdcChannel[];
    /** Reference voltage in millivolts (nRF internal = 3000 for VDD/4 + gain 1/4… use 3000). */
    readonly vrefMv: number;
    /** ADC resolution in bits. */
    readonly resolution: number;
    /**
     * Zephyr `enum adc_gain` macro for the channel setup, e.g.
     * 'ADC_GAIN_1_4' (nRF SAADC default) or 'ADC_GAIN_1' (STM32 driver
     * requires exactly this). Defaults to 'ADC_GAIN_1_4'.
     */
    readonly gain?: string;
    /**
     * Zephyr `enum adc_reference` macro, e.g. 'ADC_REF_INTERNAL'. Defaults to
     * 'ADC_REF_INTERNAL' — on nRF that is the 0.6 V internal ref measured
     * through the gain divider; the STM32 driver ALSO requires
     * ADC_REF_INTERNAL (Zephyr maps it to the VREF+ pad) with vrefMv = VDDA.
     */
    readonly reference?: string;
  };
  /**
   * DAC: the DAC device node label + the pin→channel map. Present only on chips
   * with a DAC (ESP32 has 2 channels on GPIO25/26; ESP32-S3 and nRF52840 have
   * none). Read by profileDiagnostics to flag dac.* usage on chips without it.
   */
  readonly dac?: {
    readonly device: string;
    readonly channels: readonly ZephyrDacChannel[];
  };
  /** Watchdog node label, e.g. 'wdt0'. */
  readonly wdt?: { readonly nodeLabel: string };
  /**
   * Storage partition to synthesize when the board DTS ships none. Boards
   * with an MCUboot-style partition map (most STM32s) define boot/slot
   * partitions but no `storage_partition`, which the Preferences/FS backends
   * (ZMS/littlefs) require. Present = "the overlay generator must declare
   * this partition under &flash0"; boards whose DTS already carries one
   * (ESP32 devkits) omit it — the overlay only adds the /chosen pointer.
   * The region must cover ≥2 flash pages (ZMS minimum) and stay clear of
   * the linked application image.
   */
  readonly storage?: {
    /** Partition start offset in flash, page-aligned. */
    readonly offset: number;
    /** Partition size in bytes, a multiple of the flash page size. */
    readonly size: number;
  };
  /**
   * Hardware timers exposed as Zephyr counter devices. `instance` (the HAL
   * hwtimer.* op's instance index) maps to `controllers[instance].nodeLabel`.
   * Omit on chips whose counter nodes are kernel-owned or unavailable; the
   * lowering then lowers to a comment and profileDiagnostics flags usage.
   */
  readonly hwtimer?: { readonly controllers: readonly ZephyrBusController[] };
  /**
   * WiFi capability marker. Present only on chips with a WiFi radio (ESP32-S3).
   * Read by profileDiagnostics to flag wifi.* usage on chips without a radio.
   * Omit on radioless chips (nRF52840) — its absence is the "no WiFi" signal.
   */
  readonly wifi?: { readonly supported: true };
  /**
   * Probe methods the board supports, in user-facing terms. Each entry maps a
   * friendly id (`stlink`, `dfu`, `jlink`, …) to the west runner it drives
   * plus any args the method always needs — the hardware quirks (e.g. openocd
   * needing `reset_config none` when the SRST line is unwired) live here,
   * verified with the board, instead of in user configs. One probe method
   * serves BOTH flashing and debugging (the same attach session); entries
   * that cannot debug (bootloaders) set `debug: false`. Users select one via
   * `zephyr.probe` in cuttlefish.config.ts or `--probe` on the CLI;
   * `zephyr.runner`/`runnerArgs` remain the raw escape hatch underneath.
   */
  readonly probeMethods?: readonly ZephyrProbeMethod[];
}

/**
 * A named way to attach a probe to a board — what the user picks, and what
 * flashing/debugging lower to.
 */
export interface ZephyrProbeMethod {
  /** User-facing id, stable per board (`stlink`, `dfu`, `jlink`, `uf2`, …). */
  readonly id: string;
  /** The west runner this method drives (flash and debug). */
  readonly runner: string;
  /** Args always passed with this method (before any user runnerArgs). */
  readonly args?: readonly string[];
  /** One-line human description for the wizard, doctor, and error messages. */
  readonly description?: string;
  /** Whether this method can debug (default true — SWD/JTAG probes can,
   *  bootloaders cannot and set this false explicitly). */
  readonly debug?: boolean;
  /** cortex-debug: the wire protocol (default 'swd'; esp_usb_jtag is 'jtag'). */
  readonly debugInterface?: 'swd' | 'jtag';
  /** cortex-debug servertype=jlink: the J-Link device name (e.g. 'STM32F411CE'). */
  readonly debugDevice?: string;
  /** Raw OpenOCD cfg lines for the debug server config (e.g. 'reset_config
   *  none') — the cfg-file form of the quirks `args` carry for west. */
  readonly debugCfg?: readonly string[];
  /** OpenOCD cfg `source [find …]` lines for the debug server (interface +
   *  target configs). Omitted entries fall back to the framework default. */
  readonly debugCfgSource?: readonly string[];
}

