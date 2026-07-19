import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import { getActiveChip } from '../chips/index.js';
import { parseControllerIndex } from './util.js';

export { parseControllerIndex } from './util.js';

export function uartInitLines(controllerIndex: number): string[] {
  const chip = getActiveChip();
  const cfg = chip.uart.controllers[controllerIndex];
  if (!cfg) throw new Error(`UART controller ${controllerIndex} not present on ${chip.id}`);
  return [
    `// CUTTLEFISH_UART_BEGIN`,
    `static QueueHandle_t __tc_uart${controllerIndex}_queue = NULL;`,
    `static void __tc_uart${controllerIndex}_init(unsigned long baud) {`,
    `    if (baud == 0) baud = ${cfg.defaultBaud};`,
    `    const uart_config_t ucfg = {`,
    `        .baud_rate = baud,`,
    `        .data_bits = UART_DATA_8_BITS,`,
    `        .parity = UART_PARITY_DISABLE,`,
    `        .stop_bits = UART_STOP_BITS_1,`,
    `        .source_clk = UART_SCLK_DEFAULT,`,
    `    };`,
    `    if (!__tc_uart${controllerIndex}_queue) {`,
    `        uart_driver_install(${cfg.num}, 256, 0, 8, &__tc_uart${controllerIndex}_queue, 0);`,
    `    }`,
    `    uart_param_config(${cfg.num}, &ucfg);`,
    `    uart_set_pin(${cfg.num}, ${cfg.defaultTx}, ${cfg.defaultRx}, -1, -1);`,
    `}`,
    `// CUTTLEFISH_UART_END`,
    ``,
  ];
}

/** Emit uart_write_bytes with a length that works for literals and C strings. */
function uartWrite(num: string, value: string, appendNl: boolean): string {
  const trimmed = String(value).trim();
  const isLit = /^".*"$/.test(trimmed);
  const lenExpr = isLit ? `sizeof(${trimmed}) - 1` : `strlen((const char*)${trimmed})`;
  const write = `uart_write_bytes(${num}, ${trimmed}, ${lenExpr})`;
  return appendNl
    ? `${write}; uart_write_bytes(${num}, "\\n", 1);`
    : `${write};`;
}

/** Resolve a HAL uart.* op to ESP-IDF C++. */
export function lowerUart(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  const idx = parseControllerIndex(o.port);
  const chip = getActiveChip();
  const cfg = chip.uart.controllers[idx];
  if (!cfg) throw new Error(`UART ${idx} not present on ${chip.id}`);

  switch (op.operation) {
    case 'uart.begin':
      return { code: `__tc_uart${idx}_init(${o.baud ?? 0});` };
    case 'uart.print':
      return { code: uartWrite(cfg.num, o.value, false) };
    case 'uart.println':
      return { code: uartWrite(cfg.num, o.value, true) };
    case 'uart.printf':
      return { code: `({ char __buf[128]; int __n = snprintf(__buf, sizeof(__buf), ${o.format}${o.args?.length ? ', ' + o.args.join(', ') : ''}); uart_write_bytes(${cfg.num}, __buf, __n > 0 ? __n : 0); })` };
    case 'uart.write':
      return { code: uartWrite(cfg.num, o.data, false) };
    case 'uart.read':
      return { expression: `({ uint8_t b = 0; uart_read_bytes(${cfg.num}, &b, 1, portMAX_DELAY); b; })` };
    case 'uart.available':
      return { expression: `({ size_t _len = 0; uart_get_buffered_data_len(${cfg.num}, &_len); _len; })` };
    case 'uart.peek':
      // IDF UART driver doesn't have a true peek. Use a 0-timeout read into a
      // static peek byte; if data is available, read it without consuming.
      // Since uart_read_bytes always consumes, we use the RX ring buffer:
      // peek by reading 1 byte with 0 timeout and putting it back isn't
      // supported. Best-effort: return the next byte or -1 if none available.
      return { expression: `({ uint8_t _b = 0; int _n = uart_read_bytes(${cfg.num}, &_b, 1, 0); _n > 0 ? (int)_b : -1; })` };
    case 'uart.flush':
      return { code: `uart_wait_tx_done(${cfg.num}, portMAX_DELAY);` };
    case 'uart.end':
      return { code: `uart_driver_delete(${cfg.num}); __tc_uart${idx}_queue = NULL;` };
    default:
      throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`.`);
  }
}
