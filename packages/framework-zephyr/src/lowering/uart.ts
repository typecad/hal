// ---------------------------------------------------------------------------
// UART lowering — uart_poll_out / uart_poll_in per-byte
//
// Zephyr's UART API is byte-oriented (uart_poll_out / uart_poll_in). The HAL's
// uart.print/println/write lower to per-byte poll_out loops. For console output
// the strategy's transformConsoleCall routes to printk; these uart.* ops are
// for a specific UART port (the XIAO exposes uart0 on D6/D7).
//
// The device resolves at compile time via DEVICE_DT_GET(DT_NODELABEL(uart0)).
// uart.begin configures the baud via uart_configure.
// ---------------------------------------------------------------------------

import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import type { ZephyrChipDescriptor } from '../chips/types.js';
import { parseControllerIndex } from './util.js';

/** The C variable prefix for a controller's state. */
function prefix(idx: number): string {
  return `__tc_uart${idx}`;
}

/**
 * Emit the per-controller UART device + an init helper. Called from shimLines
 * when the program uses UART.
 */
export function uartInitLines(chip: ZephyrChipDescriptor, controllerIndex: number): string[] {
  const ctrl = chip.uart?.controllers[controllerIndex];
  if (!ctrl) return [];
  const p = prefix(controllerIndex);
  return [
    '// CUTTLEFISH_UART_BEGIN',
    `static const struct device* ${p}_dev = DEVICE_DT_GET(DT_NODELABEL(${ctrl.nodeLabel}));`,
    `static void ${p}_init(uint32_t baud) {`,
    `    const struct uart_config cfg = { .baudrate = (baud ? baud : 115200), .parity = UART_CFG_PARITY_NONE, .stop_bits = UART_CFG_STOP_BITS_1, .data_bits = UART_CFG_DATA_BITS_8, .flow_ctrl = UART_CFG_FLOW_CTRL_NONE };`,
    `    uart_configure(${p}_dev, &cfg);`,
    `}`,
    '// CUTTLEFISH_UART_END',
  ];
}

/** Render a string-literal or expression to a per-byte poll_out loop. */
export function renderWrite(dev: string, value: string, newline: boolean): string {
  // String literal → emit a char-array loop (known length). Otherwise fall back
  // to a const char* cast with a strlen-guarded loop.
  if (/^".*"$/.test(value)) {
    const body = `for (size_t __i = 0; __i < sizeof(${value}) - 1; __i++) { uart_poll_out(${dev}, (${value})[__i]); }`;
    return newline ? `${body} uart_poll_out(${dev}, '\\n');` : body;
  }
  const body = `for (const char* __s = (const char*)(${value}); *__s; __s++) { uart_poll_out(${dev}, *__s); }`;
  return newline ? `${body} uart_poll_out(${dev}, '\\n');` : body;
}

/**
 * Resolve a HAL uart.* op to Zephyr C++.
 * Returns `{ code }` for statement ops, `{ expression }` for value-returning ops.
 */
export function lowerUart(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  const idx = parseControllerIndex(o.port);
  const p = prefix(idx);
  const dev = `${p}_dev`;

  switch (op.operation) {
    case 'uart.poll_write': {
      const pre = uartBaudGuard(p, o.baud);
      return { code: `${pre} ${renderWrite(dev, o.data, false)}` };
    }

    // ── Thin UART RX (hal/uart-port.ts) — interrupt-drained ring ──────────
    // The first receive call arms the driver IRQ (guarded); the ISR drains
    // the FIFO into the construction-sized static ring (uartRingStateLines).
    // available/peek/read are then pure ring arithmetic — the calls the poll
    // API honestly could not support.
    case 'uart.rx_arm':
    case 'uart.rx_available':
    case 'uart.rx_peek':
    case 'uart.rx_read': {
      const r = `__tc_uartrx${idx}`;
      const arm = `{ static bool ${r}_armed = false; if (!${r}_armed) { uart_irq_callback_user_data_set(${dev}, ${r}_isr, NULL); uart_irq_rx_enable(${dev}); ${r}_armed = true; } }`;
      if (op.operation === 'uart.rx_arm') return { code: arm };
      if (op.operation === 'uart.rx_available') {
        return { expression: `({ ${arm} (${r}_head - ${r}_tail); })` };
      }
      if (op.operation === 'uart.rx_peek') {
        return { expression: `({ ${arm} (${r}_tail < ${r}_head ? ${r}_buf[${r}_tail % ${o.ring}] : -1); })` };
      }
      return {
        expression: `({ ${arm} (${r}_tail < ${r}_head ? ${r}_buf[(${r}_tail)++ % ${o.ring}] : -1); })`,
      };
    }
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}

/** The thin-port baud preamble: apply the construction baud once via the
 *  shim's `_init` helper (uart_configure). Guarded per controller. */
function uartBaudGuard(p: string, baud: unknown): string {
  const n = typeof baud === 'number' ? baud : parseInt(String(baud ?? 0), 10);
  if (!n || isNaN(n)) return '';
  const done = `${p}_baud_done`;
  return `{ static bool ${done} = false; if (!${done}) { ${p}_init(static_cast<uint32_t>(${n})); ${done} = true; } } `;
}

/** The per-port RX ring state: a construction-sized static buffer, free-running
 *  head/tail counters (available = head - tail, no wrap ambiguity), and the
 *  ISR that drains the FIFO. A byte arriving with a full ring is dropped —
 *  the embedded-honest answer (no unbounded buffering). Emitted only for
 *  ports whose uart.rx_* ops were emitted (collectUartRings), so an unused
 *  ISR never trips -Wunused-function. */
export function uartRingStateLines(index: number, ring: number): string[] {
  const r = `__tc_uartrx${index}`;
  const dev = `__tc_uart${index}_dev`;
  return [
    '// CUTTLEFISH_UARTRX_BEGIN',
    `static uint8_t ${r}_buf[${ring}];`,
    `static volatile uint32_t ${r}_head = 0;`,
    `static volatile uint32_t ${r}_tail = 0;`,
    `static void ${r}_isr(const struct device* dev, void* user_data) {`,
    `    (void)user_data;`,
    `    uart_irq_update(dev);`,
    `    while (uart_irq_rx_ready(dev)) {`,
    `        uint8_t __c = 0;`,
    `        (void)uart_fifo_read(dev, &__c, 1);`,
    `        if ((${r}_head - ${r}_tail) < ${ring}) {`,
    `            ${r}_buf[${r}_head % ${ring}] = __c;`,
    `            ${r}_head++;`,
    `        }`,
    `    }`,
    `}`,
    `(void)${dev};`,
    '// CUTTLEFISH_UARTRX_END',
  ];
}
