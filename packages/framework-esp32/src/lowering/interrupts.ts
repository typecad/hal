import type { HALOpIR } from '@typecad/cuttlefish/api/shared';

export function interruptsInitLines(): string[] {
  return [
    `// CUTTLEFISH_INTR_BEGIN`,
    `static void __tc_intr_install(void) {`,
    `    // One-time init; idempotent if the service is already installed.`,
    `    gpio_install_isr_service(ESP_INTR_FLAG_IRAM);`,
    `}`,
    `// CUTTLEFISH_INTR_END`,
    ``,
  ];
}

// HAL uses lowercase mode names per InterruptAttachOp's docstring.
const EDGE_MAP: Record<string, string> = {
  rising: 'GPIO_INTR_POSEDGE',
  falling: 'GPIO_INTR_NEGEDGE',
  change: 'GPIO_INTR_ANYEDGE',
  low: 'GPIO_INTR_LOW_LEVEL',
  high: 'GPIO_INTR_HIGH_LEVEL',
};

/** Resolve a HAL interrupt.* op to ESP-IDF C++. */
export function lowerInterrupts(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  switch (op.operation) {
    case 'interrupt.attach': {
      const intr = EDGE_MAP[o.mode] ?? 'GPIO_INTR_ANYEDGE';
      return { code: [
        `gpio_set_intr_type((gpio_num_t)${o.pin}, ${intr});`,
        `gpio_isr_handler_add((gpio_num_t)${o.pin}, (void(*)(void*))${o.handler}, NULL);`,
      ].join(' ') };
    }
    case 'interrupt.detach':
      return { code: `gpio_isr_handler_remove((gpio_num_t)${o.pin});` };
    default:
      throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`.`);
  }
}
