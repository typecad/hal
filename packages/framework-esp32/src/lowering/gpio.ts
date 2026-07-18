import type { HALOpIR } from '@typecad/cuttlefish/api/shared';

// HAL uses lowercase mode names ("output", "input_pullup", etc.) per
// GpioSetModeOp's docstring. Map them to ESP-IDF GPIO_MODE_* constants.
const MODE_MAP: Record<string, string> = {
  output: 'GPIO_MODE_OUTPUT',
  input: 'GPIO_MODE_INPUT',
  input_output: 'GPIO_MODE_INPUT_OUTPUT',
};

/** Resolve a HAL gpio.* op to ESP-IDF C++.
 *  Returns `{ code }` for statement ops, `{ expression }` for value-returning ops.
 *  Throws on unknown ops (no silent fallback). */
export function lowerGpio(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  switch (op.operation) {
    case 'gpio.set_mode': {
      const mode = MODE_MAP[o.mode] ?? 'GPIO_MODE_INPUT';
      const extras: string[] = [];
      if (o.mode === 'input_pullup')   extras.push(`gpio_pullup_en((gpio_num_t)${o.pin});`);
      if (o.mode === 'input_pulldown') extras.push(`gpio_pulldown_en((gpio_num_t)${o.pin});`);
      // Reset the pin out of any prior mode before reconfiguring.
      const reset = `gpio_reset_pin((gpio_num_t)${o.pin});`;
      return { code: `${reset} gpio_set_direction((gpio_num_t)${o.pin}, ${mode});` + (extras.length ? ' ' + extras.join(' ') : '') };
    }
    case 'gpio.write': {
      // Literal 0/1 → 0/1; runtime expression → ternary coercion to int.
      const v = o.value;
      const rhs = typeof v === 'string' ? `((${v}) ? 1 : 0)` : (v ? 1 : 0);
      return { code: `gpio_set_level((gpio_num_t)${o.pin}, ${rhs});` };
    }
    case 'gpio.read':
      return { expression: `gpio_get_level((gpio_num_t)${o.pin})` };
    case 'gpio.toggle':
      return { code: `gpio_set_level((gpio_num_t)${o.pin}, !gpio_get_level((gpio_num_t)${o.pin}));` };
    default:
      throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`. Open an issue or use rawCpp() to emit it manually.`);
  }
}
