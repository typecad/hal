// ---------------------------------------------------------------------------
// GPIO controller resolution — pin → devicetree nodelabel
//
// Most SoCs expose a single GPIO controller, so a HAL pin maps to
// `chip.gpioController` unconditionally. SoCs that split GPIO across multiple
// devicetree nodes (ESP32-S3: `gpio0` 0–31, `gpio1` 32–48) list a range per
// controller in `chip.gpioControllers`. These helpers route a HAL pin to the
// owning controller.
//
// Two forms:
//   - controllerNodelabelForPin(): used by the compile-time lowering paths
//     (gpio/pulse/spi raw writes), where the pin number is a literal known at
//     transpile time. Resolves to a single nodelabel so the emitted
//     `DT_NODELABEL(<nodelabel>)` macro is statically valid.
//   - emitGpioDevDispatcher(): used by paths that take a RUNTIME pin (the
//     @typecad/safety __tc_gpio_read/__tc_gpio_write shims). Emits a tiny
//     `__tc_gpio_dev(uint32_t pin)` that returns the owning `const struct
//     device*`, so a single shim body handles any pin. Single-controller SoCs
//     collapse to a one-liner.
// ---------------------------------------------------------------------------

import type { ZephyrChipDescriptor, ZephyrGpioController } from './types.js';

/**
 * Resolve the devicetree nodelabel of the GPIO controller that owns `pin`.
 *
 * For single-controller SoCs (no `gpioControllers`) this is always
 * `chip.gpioController`. For multi-controller SoCs it finds the entry whose
 * [minPin, maxPin] range contains `pin`, falling back to `chip.gpioController`
 * for out-of-range pins (e.g. the manifest probe's synthetic pin 0).
 */
export function controllerNodelabelForPin(chip: ZephyrChipDescriptor, pin: number): string {
  const hit = controllerRangeForPin(chip, pin);
  return hit ? hit.nodelabel : chip.gpioController;
}

/**
 * The owning controller range for a HAL pin, if the chip declares a split.
 */
export function controllerRangeForPin(
  chip: ZephyrChipDescriptor,
  pin: number,
): ZephyrGpioController | undefined {
  const ranges = chip.gpioControllers;
  if (ranges && ranges.length > 0) {
    return ranges.find((r) => pin >= r.minPin && pin <= r.maxPin);
  }
  return undefined;
}

/**
 * The PORT-RELATIVE pin index for the raw gpio_pin_*_raw() API — the Zephyr
 * raw calls address the index WITHIN the controller, not the global HAL pin
 * number. For split SoCs each controller's `minPin` is its base (STM32:
 * gpiob minPin 16, so PB12 = pin 28 → raw 12); single-controller SoCs have
 * no offset. Emitting the global number against a port driver would address
 * a nonexistent port bit (STM32 gpiob is 0–15) and fail at runtime.
 */
export function controllerRawPinForPin(chip: ZephyrChipDescriptor, pin: number): number {
  const hit = controllerRangeForPin(chip, pin);
  return pin - (hit?.minPin ?? 0);
}

/**
 * Emit the C++ source for runtime pin → GPIO-device / port-relative-index
 * dispatchers.
 *
 * Returns lines defining:
 *  - `static inline const struct device* __tc_gpio_dev(uint32_t pin)` — the
 *    owning controller's device, resolved via DEVICE_DT_GET(DT_NODELABEL(...))
 *    at compile time (the macro is evaluated per branch, so it is always
 *    statically valid); only `pin` is runtime.
 *  - `static inline gpio_pin_t __tc_gpio_pin(uint32_t pin)` — the
 *    port-relative index for gpio_pin_*_raw() (see controllerRawPinForPin).
 *    The runtime shim paths (UI pin-watch, safety voters) take a runtime pin,
 *    so they cannot bake the offset in at emit time.
 *
 * For a single-controller SoC both collapse to one-liners, so the existing
 * XIAO nRF52840 behavior is byte-for-byte unchanged.
 */
export function emitGpioDevDispatcher(chip: ZephyrChipDescriptor): string[] {
  const ranges = chip.gpioControllers;
  if (!ranges || ranges.length === 0) {
    return [
      'static inline const struct device* __tc_gpio_dev(uint32_t pin) {',
      `    (void)pin;`,
      `    return DEVICE_DT_GET(DT_NODELABEL(${chip.gpioController}));`,
      '}',
      'static inline gpio_pin_t __tc_gpio_pin(uint32_t pin) {',
      `    return (gpio_pin_t)pin;`,
      '}',
    ];
  }
  const lines: string[] = [
    'static inline const struct device* __tc_gpio_dev(uint32_t pin) {',
  ];
  const pinLines: string[] = [
    'static inline gpio_pin_t __tc_gpio_pin(uint32_t pin) {',
  ];
  for (const r of ranges) {
    lines.push(
      `    if (pin >= ${r.minPin} && pin <= ${r.maxPin}) { return DEVICE_DT_GET(DT_NODELABEL(${r.nodelabel})); }`,
    );
    if (r.minPin === 0) {
      pinLines.push(
        `    if (pin >= ${r.minPin} && pin <= ${r.maxPin}) { return (gpio_pin_t)pin; }`,
      );
    } else {
      pinLines.push(
        `    if (pin >= ${r.minPin} && pin <= ${r.maxPin}) { return (gpio_pin_t)(pin - ${r.minPin}); }`,
      );
    }
  }
  lines.push(
    `    return DEVICE_DT_GET(DT_NODELABEL(${chip.gpioController}));`,
    '}',
  );
  pinLines.push(
    `    return (gpio_pin_t)pin;`,
    '}',
  );
  return [...lines, ...pinLines];
}
