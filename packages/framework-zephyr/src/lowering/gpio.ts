// ---------------------------------------------------------------------------
// GPIO lowering — devicetree-spec bridge
//
// Translates HAL gpio.* ops to Zephyr driver C++. Two addressing modes:
//
//  1. Devicetree spec (preferred): if the HAL pin matches a dtSpec in the
//     active chip descriptor, emit gpio_pin_*_dt() calls against a
//     `__tc_dt_<alias>` gpio_dt_spec. This honors the node's polarity flags
//     (GPIO_ACTIVE_LOW), so logical value 1 = LED on for an active-low LED.
//
//  2. Raw fallback: pins without a dtSpec are addressed via the SoC's gpio
//     controller node (DEVICE_DT_GET(DT_NODELABEL(gpio0))) and the
//     gpio_pin_*_raw() API. Polarity is physical (raw bypasses DT flags).
//     The manifest validator's probe (which sends {operation, pin:0} with no
//     port) hits this path, so it must return a lowered result, not undefined.
// ---------------------------------------------------------------------------

import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import type { ZephyrChipDescriptor } from '../chips/types.js';
import { controllerNodelabelForPin, controllerRawPinForPin } from '../chips/controllers.js';

/** The C identifier emitted for a pin's gpio_dt_spec variable. */
export function dtSpecVarName(dtSpec: string): string {
  return `__tc_dt_${dtSpec}`;
}

/** Look up a dtSpec by GPIO pin number; undefined if the pin has none. */
function findDtSpec(chip: ZephyrChipDescriptor, pin: number) {
  return chip.gpio.dtSpecs.find((s) => s.pin === pin);
}

// HAL passes UPPERCASE modes ("OUTPUT") while docs say lowercase ("output").
// The *_pullup / *_pulldown modes map to GPIO_INPUT (Zephyr does not have
// separate input+pull mode flags) and OR in a GPIO_PULL_UP / GPIO_PULL_DOWN
// bit via `dtFlagsForMode` — without that bit the pin floats, so INPUT_PULLUP
// was a silent no-op (bug B1). Mirrors the gpio_pullup_en/gpio_pulldown_en
// extras framework-esp32 emits for the same modes.
const MODE_MAP: Record<string, string> = {
  output: 'GPIO_OUTPUT',
  OUTPUT: 'GPIO_OUTPUT',
  input: 'GPIO_INPUT',
  INPUT: 'GPIO_INPUT',
  input_pullup: 'GPIO_INPUT',
  INPUT_PULLUP: 'GPIO_INPUT',
  input_pulldown: 'GPIO_INPUT',
  INPUT_PULLDOWN: 'GPIO_INPUT',
};

/** Additional DT flag bits for a HAL mode, OR'd into the configure flags.
 *  Returns '' for modes with no extra bits so the join leaves the mode alone. */
function dtFlagsForMode(mode: string): string {
  const m = (mode ?? '').toLowerCase();
  if (m === 'input_pullup') return ' | GPIO_PULL_UP';
  if (m === 'input_pulldown') return ' | GPIO_PULL_DOWN';
  return '';
}

/** Combined mode + pull flags for a HAL mode string, e.g.
 *  'INPUT_PULLUP' → 'GPIO_INPUT | GPIO_PULL_UP'. */
function flagsForMode(mode: string): string {
  const base = MODE_MAP[mode] ?? 'GPIO_INPUT';
  return base + dtFlagsForMode(mode);
}

/**
 * Resolve a HAL gpio.* op to Zephyr C++.
 * Returns `{ code }` for statement ops, `{ expression }` for value-returning ops.
 */
export function lowerGpio(
  op: HALOpIR,
  chip: ZephyrChipDescriptor,
): { code?: string; expression?: string } {
  const o = op as any;
  const pin: number = o.pin;
  const spec = findDtSpec(chip, pin);

  if (spec) {
    return lowerGpioDtSpec(op, spec.dtSpec);
  }
  return lowerGpioRaw(op, chip);
}

/** Devicetree-spec path — polarity-correct via gpio_pin_*_dt(). */
function lowerGpioDtSpec(
  op: HALOpIR,
  dtSpec: string,
): { code?: string; expression?: string } {
  const o = op as any;
  const varName = dtSpecVarName(dtSpec);

  switch (op.operation) {
    case 'gpio.set_mode': {
      return { code: `gpio_pin_configure_dt(&${varName}, ${flagsForMode(o.mode)});` };
    }
    case 'gpio.write': {
      // Literal 0/1 stays as-is; runtime expression coerced to int via ternary.
      const v = o.value;
      const rhs = typeof v === 'string' ? `((${v}) ? 1 : 0)` : v ? 1 : 0;
      return { code: `gpio_pin_set_dt(&${varName}, ${rhs});` };
    }
    case 'gpio.read':
      return { expression: `gpio_pin_get_dt(&${varName})` };
    case 'gpio.toggle':
      return { code: `gpio_pin_toggle_dt(&${varName});` };
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}

/**
 * Raw-controller path — for pins without a DT spec (and the manifest probe).
 * Uses the SoC's primary GPIO controller node. Polarity is physical.
 */
function lowerGpioRaw(
  op: HALOpIR,
  chip: ZephyrChipDescriptor,
): { code?: string; expression?: string } {
  const o = op as any;
  const pin: number = o.pin;
  // Resolve the owning controller by pin range (ESP32-S3 splits GPIO across
  // gpio0/gpio1; STM32 across gpioa/gpiob/gpioc). For single-controller SoCs
  // this is just chip.gpioController. The raw API takes the PORT-RELATIVE
  // index (STM32 gpiob is 0-15), not the global HAL pin number.
  const controller = `DEVICE_DT_GET(DT_NODELABEL(${controllerNodelabelForPin(chip, pin)}))`;
  const rawPin = controllerRawPinForPin(chip, pin);

  switch (op.operation) {
    case 'gpio.set_mode': {
      return { code: `gpio_pin_configure(${controller}, ${rawPin}, ${flagsForMode(o.mode)});` };
    }
    case 'gpio.write': {
      const v = o.value;
      const rhs = typeof v === 'string' ? `((${v}) ? 1 : 0)` : v ? 1 : 0;
      return { code: `gpio_pin_set_raw(${controller}, ${rawPin}, ${rhs});` };
    }
    case 'gpio.read':
      return { expression: `gpio_pin_get_raw(${controller}, ${rawPin})` };
    case 'gpio.toggle':
      // Native atomic toggle — never read-modify-write. gpio_pin_get_raw on
      // a direction-only output reads the input latch, which is undefined on
      // SoCs that don't latch it. Zephyr's toggle API has no _raw variant —
      // gpio_pin_toggle is the driver-level atomic toggle, and for pins
      // configured without GPIO_ACTIVE_LOW the logical level equals the
      // physical one, so it matches the get_raw/set_raw used elsewhere.
      return { code: `gpio_pin_toggle(${controller}, ${rawPin});` };
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
