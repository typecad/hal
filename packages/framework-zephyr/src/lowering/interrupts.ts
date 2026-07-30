// ---------------------------------------------------------------------------
// Interrupt lowering — gpio_init_callback + gpio_add_callback
//
// The most complex lowering: Zephyr's GPIO interrupt model requires a
// `struct gpio_callback` per pin, registered with gpio_add_callback, with a
// trampoline that calls the user's C handler. The descriptor's gpio.interruptPins
// lists the pins with DT specs (buttons). The user's handler is a free C
// function; the trampoline calls it with no args (Arduino attachInterrupt style).
//
// Each interrupt pin gets a static callback struct + a trampoline in shimLines.
// attach enables + adds the callback; detach disables + removes it.
// ---------------------------------------------------------------------------

import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import type { ZephyrChipDescriptor, ZephyrInterruptPin } from '../chips/types.js';

/** Look up an interrupt pin spec by HAL pin number. */
function findIntPin(chip: ZephyrChipDescriptor, pin: number): ZephyrInterruptPin | undefined {
  return chip.gpio.interruptPins?.find((p) => p.pin === pin);
}

/** The C variable name for a pin's gpio_dt_spec. */
function dtSpecVar(dtSpec: string): string {
  return `__tc_int_${dtSpec.replace(/-/g, '_')}`;
}

/** Map a HAL interrupt mode string to Zephyr GPIO_INT_* flags. */
function modeToFlags(mode: string): string {
  switch (mode.toLowerCase()) {
    case 'rising': return 'GPIO_INT_EDGE_RISING';
    case 'falling': return 'GPIO_INT_EDGE_FALLING';
    case 'change': return 'GPIO_INT_EDGE_BOTH';
    case 'high': return 'GPIO_INT_LEVEL_HIGH';
    case 'low': return 'GPIO_INT_LEVEL_LOW';
    default: return 'GPIO_INT_EDGE_BOTH';
  }
}

/**
 * Emit the per-pin interrupt callback state + trampolines. Called from shimLines
 * when the program uses interrupts. The trampoline calls a user function via a
 * function-pointer static, set at attach time.
 */
export function interruptInitLines(chip: ZephyrChipDescriptor): string[] {
  const pins = chip.gpio.interruptPins ?? [];
  if (pins.length === 0) return [];
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
  lines.push('// CUTTLEFISH_INT_END');
  return lines;
}

/**
 * Resolve a HAL interrupt.* op to Zephyr C++.
 * Returns `{ code }` for statement ops, `{ expression }` for value-returning ops.
 *
 * Note: attach requires the pin to be in the descriptor's interruptPins. If a
 * program attaches to an unlisted pin, we fall back to a diagnostic comment
 * (the probe uses an unknown pin, so the manifest marks these 'supported' via
 * the comment lowering — the probe sees a non-undefined return).
 */
export function lowerInterrupt(
  op: HALOpIR,
  chip: ZephyrChipDescriptor,
): { code?: string; expression?: string } {
  const o = op as any;
  const pin = findIntPin(chip, o.pin);

  if (!pin) {
    // Fallback (also covers the manifest probe): a diagnostic comment so the
    // resolver returns non-undefined. Real attach needs a descriptor entry.
    if (op.operation === 'interrupt.attach') {
      return { code: `/* interrupt.attach(pin ${o.pin}): no DT spec — add to chip descriptor gpio.interruptPins */` };
    }
    return { code: `/* interrupt.detach(pin ${o.pin}): no DT spec */` };
  }

  const v = dtSpecVar(pin.dtSpec);

  switch (op.operation) {
    case 'interrupt.attach': {
      const flags = modeToFlags(o.mode);
      return {
        code: [
          `${v}_handler = (${o.handler});`,
          `gpio_pin_configure_dt(&${v}, GPIO_INPUT);`,
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
