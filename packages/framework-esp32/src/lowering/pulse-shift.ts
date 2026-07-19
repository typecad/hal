import type { HALOpIR } from '@typecad/cuttlefish/api/shared';

export function pulseInitLines(): string[] {
  return [
    `// CUTTLEFISH_PULSE_BEGIN`,
    `static uint32_t __tc_pulse_in(int pin, int state, uint32_t timeout_us) {`,
    `    int64_t start = esp_timer_get_time();`,
    `    while (gpio_get_level((gpio_num_t)pin) != state) { if ((uint32_t)(esp_timer_get_time() - start) > timeout_us) return 0; }`,
    `    int64_t edge = esp_timer_get_time();`,
    `    while (gpio_get_level((gpio_num_t)pin) == state) { if ((uint32_t)(esp_timer_get_time() - edge) > timeout_us) return 0; }`,
    `    return (uint32_t)(esp_timer_get_time() - edge);`,
    `}`,
    `// CUTTLEFISH_PULSE_END`,
    ``,
  ];
}

export function shiftInitLines(): string[] {
  return [
    `// CUTTLEFISH_SHIFT_BEGIN`,
    `static uint8_t __tc_shift_in(int dataPin, int clockPin, int bitOrder) {`,
    `    uint8_t v = 0;`,
    `    for (int i = 0; i < 8; i++) {`,
    `        gpio_set_level((gpio_num_t)clockPin, 1); esp_rom_delay_us(1);`,
    `        if (bitOrder) v |= (gpio_get_level((gpio_num_t)dataPin) & 1) << (7 - i);`,
    `        else          v |= (gpio_get_level((gpio_num_t)dataPin) & 1) << i;`,
    `        gpio_set_level((gpio_num_t)clockPin, 0); esp_rom_delay_us(1);`,
    `    }`,
    `    return v;`,
    `}`,
    `static void __tc_shift_out(int dataPin, int clockPin, int bitOrder, uint8_t val) {`,
    `    for (int i = 0; i < 8; i++) {`,
    `        int bit = bitOrder ? !!(val & (1 << (7 - i))) : !!(val & (1 << i));`,
    `        gpio_set_level((gpio_num_t)dataPin, bit);`,
    `        gpio_set_level((gpio_num_t)clockPin, 1); esp_rom_delay_us(1);`,
    `        gpio_set_level((gpio_num_t)clockPin, 0); esp_rom_delay_us(1);`,
    `    }`,
    `}`,
    `// CUTTLEFISH_SHIFT_END`,
    ``,
  ];
}

export function pulseShiftInitLines(): string[] {
  return [...pulseInitLines(), ...shiftInitLines()];
}

// HAL's bitOrder is "lsb" | "msb". Translate to the 0|1 form the helper uses.
function bitOrderFlag(s: string | undefined): number {
  return s === 'msb' ? 1 : 0;
}

/** Resolve a HAL pulse.* op. */
export function lowerPulse(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  switch (op.operation) {
    case 'pulse.in':
      return { expression: `__tc_pulse_in(${o.pin}, ${o.value}, ${o.timeout ?? 1000000})` };
    case 'pulse.in_long':
      return { expression: `__tc_pulse_in(${o.pin}, ${o.value}, ${o.timeout ?? 100000000})` };
    default:
      throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`.`);
  }
}

/** Resolve a HAL shift.* op. */
export function lowerShift(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  switch (op.operation) {
    case 'shift.in':
      return { expression: `__tc_shift_in(${o.dataPin}, ${o.clockPin}, ${bitOrderFlag(o.bitOrder)})` };
    case 'shift.out':
      return { code: `__tc_shift_out(${o.dataPin}, ${o.clockPin}, ${bitOrderFlag(o.bitOrder)}, ${o.value});` };
    default:
      throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`.`);
  }
}
