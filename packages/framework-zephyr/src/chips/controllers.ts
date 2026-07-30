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

import type { ZephyrChipDescriptor } from './types.js';

/**
 * Resolve the devicetree nodelabel of the GPIO controller that owns `pin`.
 *
 * For single-controller SoCs (no `gpioControllers`) this is always
 * `chip.gpioController`. For multi-controller SoCs it finds the entry whose
 * [minPin, maxPin] range contains `pin`, falling back to `chip.gpioController`
 * for out-of-range pins (e.g. the manifest probe's synthetic pin 0).
 */
export function controllerNodelabelForPin(chip: ZephyrChipDescriptor, pin: number): string {
  const ranges = chip.gpioControllers;
  if (ranges && ranges.length > 0) {
    const hit = ranges.find((r) => pin >= r.minPin && pin <= r.maxPin);
    if (hit) return hit.nodelabel;
  }
  return chip.gpioController;
}

/**
 * Emit the C++ source for a runtime pin → GPIO-device dispatcher.
 *
 * Returns lines defining `static inline const struct device* __tc_gpio_dev(uint32_t pin)`.
 * Each branch resolves its controller via `DEVICE_DT_GET(DT_NODELABEL(...))` at
 * compile time (the macro is evaluated per branch, so it is always statically
 * valid); only `pin` is runtime. For a single-controller SoC this collapses to
 * a one-liner returning that controller, so the existing XIAO nRF52840 behavior
 * is byte-for-byte unchanged.
 */
export function emitGpioDevDispatcher(chip: ZephyrChipDescriptor): string[] {
  const ranges = chip.gpioControllers;
  if (!ranges || ranges.length === 0) {
    return [
      'static inline const struct device* __tc_gpio_dev(uint32_t pin) {',
      `    (void)pin;`,
      `    return DEVICE_DT_GET(DT_NODELABEL(${chip.gpioController}));`,
      '}',
    ];
  }
  const lines: string[] = [
    'static inline const struct device* __tc_gpio_dev(uint32_t pin) {',
  ];
  for (const r of ranges) {
    lines.push(
      `    if (pin >= ${r.minPin} && pin <= ${r.maxPin}) { return DEVICE_DT_GET(DT_NODELABEL(${r.nodelabel})); }`,
    );
  }
  lines.push(
    `    return DEVICE_DT_GET(DT_NODELABEL(${chip.gpioController}));`,
    '}',
  );
  return lines;
}
