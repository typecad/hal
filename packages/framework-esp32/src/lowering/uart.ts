import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import { getActiveChip } from '../chips/index.js';

/** Parse a peripheral bus/port string like "UART0" / "I2C1" / "SPI2" → numeric index. */
export function parseControllerIndex(busOrPort: string | undefined): number {
  if (!busOrPort) return 0;
  const m = busOrPort.match(/(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}

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
    case 'uart.println': {
      // uart.print takes a resolved C++ expression; emit as a string write.
      // println appends \n. The expression may be a string literal or a
      // variable; for non-string types the caller is expected to have already
      // formatted via snprintf (cuttlefish's console lowering handles this).
      const nl = op.operation === 'uart.println' ? '\\n' : '';
      return { code: `uart_write_bytes(${cfg.num}, ${o.value}, sizeof(${o.value}) - 1);` +
        (nl ? ` uart_write_bytes(${cfg.num}, "\\n", 1);` : '') };
    }
    case 'uart.printf':
      return { code: `({ char __buf[128]; int __n = snprintf(__buf, sizeof(__buf), ${o.format}${o.args?.length ? ', ' + o.args.join(', ') : ''}); uart_write_bytes(${cfg.num}, __buf, __n > 0 ? __n : 0); })` };
    case 'uart.write':
      return { code: `uart_write_bytes(${cfg.num}, ${o.data}, sizeof(${o.data}) - 1);` };
    case 'uart.read':
      return { expression: `({ uint8_t b = 0; uart_read_bytes(${cfg.num}, &b, 1, portMAX_DELAY); b; })` };
    case 'uart.available':
      return { expression: `({ size_t _len = 0; uart_get_buffered_data_len(${cfg.num}, &_len); _len; })` };
    case 'uart.flush':
      return { code: `uart_wait_tx_done(${cfg.num}, portMAX_DELAY);` };
    case 'uart.end':
      return { code: `uart_driver_delete(${cfg.num}); __tc_uart${idx}_queue = NULL;` };
    default:
      throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`.`);
  }
}
