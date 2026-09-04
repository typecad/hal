// ---------------------------------------------------------------------------
// Interrupt lowering — gpio_init_callback + gpio_add_callback
//
// The most complex lowering: Zephyr's GPIO interrupt model requires a
// `struct gpio_callback` per pin, registered with gpio_add_callback, with a
// trampoline that calls the user's C handler. The descriptor's gpio.interruptPins
// lists the pins with DT specs (buttons). The user's handler is a free C
// function; the trampoline calls it with no args.
//
// Each interrupt pin gets a static callback struct + a trampoline in shimLines.
// attach enables + adds the callback; detach disables + removes it.
// ---------------------------------------------------------------------------

import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import type { ZephyrChipDescriptor, ZephyrInterruptPin } from '../chips/types.js';
import { controllerNodelabelForPin, controllerRawPinForPin, controllerRangeForPin } from '../chips/controllers.js';
import { ZEPHYR_GPIO_INTS } from '@typecad/hal';

/** Look up an interrupt pin spec by HAL pin number. */
function findIntPin(chip: ZephyrChipDescriptor, pin: number): ZephyrInterruptPin | undefined {
  return chip.gpio.interruptPins?.find((p) => p.pin === pin);
}

/** The C variable name for a pin's gpio_dt_spec. */
function dtSpecVar(dtSpec: string): string {
  return `__tc_int_${dtSpec.replace(/-/g, '_')}`;
}

// ── Thin GPIO interrupts (hal/gpio-pin.ts onInterrupt) — INT_* tokens ─────
//
// The name set comes from the GENERATED Zephyr token table (parsed from the
// pinned tree's drivers/gpio.h).

const GPIO_INT_TOKENS: Record<string, string> = Object.fromEntries(
  ZEPHYR_GPIO_INTS.map((f) => [`GPIO.${f}`, `GPIO_${f}`]),
);

/** Map thin-GPIO INT token text to the GPIO_INT_* macro. */
export function gpioIntTokenToMacro(intFlags: string): string {
  const token = String(intFlags ?? '').trim();
  const m = GPIO_INT_TOKENS[token];
  if (!m) {
    throw new Error(
      `GPIO interrupt flag '${token}' is not a known GPIO.INT_* token — valid: ${Object.keys(GPIO_INT_TOKENS).join(', ')}.`,
    );
  }
  return m;
}

/**
 * Emit the per-pin interrupt callback state + trampolines. Called from shimLines
 * when the program uses interrupts. The trampoline calls a user function via a
 * function-pointer static, set at attach time.
 *
 * Two paths:
 *  - descriptor `gpio.interruptPins` (buttons with DT specs): callback state
 *    against the DT spec, polarity-correct via gpio_*_dt.
 *  - `usedPins` (any other pin the program attaches to): raw-controller state —
 *    GPIO.onInterrupt() works on EVERY GPIO, not just DT-aliased buttons. Each
 *    such pin gets its own callback struct + trampoline addressed by the owning
 *    controller (STM32 splits gpioa/gpiob/gpioc) and port-relative bit.
 */
export function interruptInitLines(chip: ZephyrChipDescriptor, usedPins?: ReadonlySet<number>): string[] {
  const pins = chip.gpio.interruptPins ?? [];
  const lines: string[] = ['// CUTTLEFISH_INT_BEGIN'];
  for (const pin of pins) {
    const v = dtSpecVar(pin.dtSpec);
    lines.push(
      `static const struct gpio_dt_spec ${v} = GPIO_DT_SPEC_GET(DT_ALIAS(${pin.dtSpec}), gpios);`,
      `static struct gpio_callback ${v}_cb;`,
      `static void (*${v}_handler)(void) = NULL;`,
      `static void ${v}_tramp(const struct device* port, struct gpio_callback* cb, gpio_port_pins_t pins_v) {`,
      `    (void)port; (void)cb; (void)pins_v;`,
      `    if (${v}_handler) { ${v}_handler(); }`,
      `}`,
    );
  }
  if (usedPins) {
    for (const pin of usedPins) {
      if (pins.some((p) => p.pin === pin)) continue;
      const v = `__tc_int_raw${pin}`;
      lines.push(
        `static const struct device* ${v}_dev = DEVICE_DT_GET(DT_NODELABEL(${controllerNodelabelForPin(chip, pin)}));`,
        `static struct gpio_callback ${v}_cb;`,
        `static void (*${v}_handler)(void) = NULL;`,
        `static void ${v}_tramp(const struct device* port, struct gpio_callback* cb, gpio_port_pins_t pins_v) {`,
        `    (void)port; (void)cb; (void)pins_v;`,
        `    if (${v}_handler) { ${v}_handler(); }`,
        `}`,
      );
    }
  }
  lines.push('// CUTTLEFISH_INT_END');
  return lines;
}

/**
 * Collect the pin numbers the program attaches interrupts to (any GPIO — not
 * just descriptor-listed buttons). Feeds interruptInitLines' raw-path state.
 */
export function collectInterruptPins(program: unknown): Set<number> {
  const pins = new Set<number>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    const op = n.operation;
    if (op && typeof op === 'object') {
      const o = op as Record<string, unknown>;
      if (o.operation === 'interrupt.attach_flags' && typeof o.pin === 'number') {
        pins.add(o.pin as number);
      }
    }
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) { for (const item of v) visit(item); }
      else if (v && typeof v === 'object') visit(v);
    }
  };
  visit(program);
  return pins;
}

/**
 * Resolve a HAL interrupt.* op to Zephyr C++.
 * Returns `{ code }` for statement ops, `{ expression }` for value-returning ops.
 *
 * Two paths: pins listed in the descriptor's gpio.interruptPins (DT-aliased
 * buttons) go through the polarity-correct gpio_*_dt chain; every other GPIO
 * attaches through the raw-controller chain (any GPIO is interrupt-capable on
 * the supported SoCs — the descriptor list exists for DT specs, not as a
 * capability gate). The manifest probe's synthetic op keeps the comment
 * fallback (no program ⇒ no shim state was emitted for the raw path).
 */
export function lowerInterrupt(
  op: HALOpIR,
  chip: ZephyrChipDescriptor,
): { code?: string; expression?: string } {
  const o = op as any;
  const pin = findIntPin(chip, o.pin);

  if (!pin) {
    // Raw-controller path — state comes from interruptInitLines' usedPins.
    // Only for pins a declared controller range covers: an out-of-range number
    // (e.g. pin 99 on a 34-pin SoC) keeps the diagnostic comment. Single-
    // controller chips declare no ranges, so every number is taken as real and
    // the driver rejects invalid bits at runtime (Arduino-like behavior).
    const knownPin = typeof o.pin === 'number' && Number.isInteger(o.pin)
      && (!chip.gpioControllers || chip.gpioControllers.length === 0
        || controllerRangeForPin(chip, o.pin) !== undefined);
    if (knownPin) {
      const v = `__tc_int_raw${o.pin}`;
      const raw = controllerRawPinForPin(chip, o.pin);
      if (op.operation === 'interrupt.attach_flags') {
        // Thin GPIO: INT_* tokens instead of mode strings. The pin's
        // input/pull configuration already came from the construction flags
        // (the class emits gpio.configure ahead of this op) — no INPUT
        // override here, unlike the legacy raw path above.
        const flags = gpioIntTokenToMacro(o.intFlags);
        return {
          code: [
            `${v}_handler = (${o.handler});`,
            `gpio_init_callback(&${v}_cb, ${v}_tramp, BIT(${raw}));`,
            `gpio_pin_interrupt_configure(${v}_dev, ${raw}, ${flags});`,
            `gpio_add_callback(${v}_dev, &${v}_cb);`,
          ].join(' '),
        };
      }
      if (op.operation === 'interrupt.detach') {
        return {
          code: `gpio_pin_interrupt_configure(${v}_dev, ${raw}, GPIO_INT_DISABLE); gpio_remove_callback(${v}_dev, &${v}_cb); ${v}_handler = NULL;`,
        };
      }
    }
    // Fallback (also covers the manifest probe): a diagnostic comment so the
    // resolver returns non-undefined. Real attach needs a descriptor entry.
    if (op.operation === 'interrupt.attach_flags') {
      return { code: `/* interrupt.attach_flags(pin ${o.pin}): no DT spec — add to chip descriptor gpio.interruptPins */` };
    }
    return { code: `/* interrupt.detach(pin ${o.pin}): no DT spec */` };
  }

  const v = dtSpecVar(pin.dtSpec);

  switch (op.operation) {
    case 'interrupt.attach_flags': {
      // Thin GPIO: INT_* tokens; construction flags already configured the pin.
      const flags = gpioIntTokenToMacro(o.intFlags);
      return {
        code: [
          `${v}_handler = (${o.handler});`,
          `gpio_init_callback(&${v}_cb, ${v}_tramp, BIT(${v}.pin));`,
          `gpio_pin_interrupt_configure_dt(&${v}, ${flags});`,
          `gpio_add_callback(${v}.port, &${v}_cb);`,
        ].join(' '),
      };
    }
    case 'interrupt.detach':
      return {
        code: `gpio_pin_interrupt_configure_dt(&${v}, GPIO_INT_DISABLE); gpio_remove_callback(${v}.port, &${v}_cb); ${v}_handler = NULL;`,
      };
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
