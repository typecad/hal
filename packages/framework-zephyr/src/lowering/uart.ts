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
function renderWrite(dev: string, value: string, newline: boolean): string {
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
    case 'uart.begin':
      return { code: `${p}_init(static_cast<uint32_t>(${o.baud}));` };
    case 'uart.end':
      return { code: `(void)${dev};` };
    case 'uart.print':
      return { code: renderWrite(dev, o.value, false) };
    case 'uart.println':
      return { code: renderWrite(dev, o.value, true) };
    case 'uart.write':
      return { code: renderWrite(dev, o.data, false) };
    case 'uart.printf': {
      // snprintf into a buffer, then poll_out each byte.
      const fmt = o.format;
      const args = (o.args ?? []).join(', ');
      const argList = args ? `, ${args}` : '';
      return {
        code: `char __buf[128]; int __n = snprintk(__buf, sizeof(__buf), ${fmt}${argList}); for (int __i = 0; __i < __n; __i++) { uart_poll_out(${dev}, __buf[__i]); }`,
      };
    }
    case 'uart.read':
      // Non-blocking poll; returns the byte or -1 if none available.
      return { expression: `({ unsigned char __b = 0; (uart_poll_in(${dev}, &__b) == 0) ? (int)__b : -1; })` };
    case 'uart.peek':
      // The poll API has no buffered-byte store, so there is no true peek.
      // Return -1 (the Arduino "no data" sentinel) rather than blocking. This
      // is an honest limitation of the byte-level poll driver; an interrupt- or
      // DMA-backed UART driver would be needed for real peek semantics.
      return { expression: '(-1)' };
    case 'uart.available':
      // The poll API reports only "at least one byte ready" via uart_poll_in's
      // return code — it has no buffered-byte count, and probing with poll_in
      // would DRAIN the very byte the caller next wants to read. So we cannot
      // honestly report availability. Return 0 (Arduino's "no data" value)
      // rather than the old truthy -1, so `if (uart.available())` loops don't
      // spin forever on a false-positive. Callers should instead just call
      // uart.read() directly (it returns -1 when no byte is ready). For true
      // buffered availability, use an interrupt/DMA-backed UART driver.
      return { expression: '(0)' };
    case 'uart.flush':
      // poll_out is synchronous (blocking until sent); flush is a no-op.
      return { code: `(void)${dev};` };
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
