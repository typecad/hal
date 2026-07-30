import { describe, it, expect } from 'vitest';
import { lowerUart, uartInitLines } from '../../../../packages/framework-zephyr/src/lowering/uart';
import { XIAO_BLE } from '../../../../packages/framework-zephyr/src/chips/xiao-ble';

describe('uart init block', () => {
  it('emits CUTTLEFISH_UART markers + the uart0 device + a baud-config helper', () => {
    const lines = uartInitLines(XIAO_BLE, 0).join('\n');
    expect(lines).toContain('// CUTTLEFISH_UART_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_UART_END');
    expect(lines).toContain('DEVICE_DT_GET(DT_NODELABEL(uart0))');
    expect(lines).toContain('uart_configure');
  });
});

describe('uart lowering', () => {
  it('begin → configures baud via the init helper', () => {
    expect(lowerUart({ operation: 'uart.begin', port: 'UART0', baud: 9600 } as any))
      .toEqual({ code: '__tc_uart0_init(static_cast<uint32_t>(9600));' });
  });

  it('print of a string literal → per-byte poll_out loop', () => {
    const out = lowerUart({ operation: 'uart.print', port: 'UART0', value: '"hi"' } as any);
    expect(out.code).toContain('uart_poll_out(__tc_uart0_dev, ("hi")[__i])');
    expect(out.code).not.toContain('\\n');
  });

  it('println of a string literal appends a newline', () => {
    const out = lowerUart({ operation: 'uart.println', port: 'UART0', value: '"hi"' } as any);
    expect(out.code).toContain("uart_poll_out(__tc_uart0_dev, '\\n')");
  });

  it('printf → snprintk + poll_out loop', () => {
    const out = lowerUart({ operation: 'uart.printf', port: 'UART0', format: '"%d"', args: [42] } as any);
    expect(out.code).toContain('snprintk(__buf');
    expect(out.code).toContain('uart_poll_out');
  });

  it('read → non-blocking poll, byte or -1 (expression)', () => {
    const out = lowerUart({ operation: 'uart.read', port: 'UART0' } as any);
    expect(out.expression).toContain('uart_poll_in(__tc_uart0_dev, &__b) == 0');
    expect(out.expression).toContain(': -1');
  });

  // Q3: peek/available are honest about the poll-API limitations.
  it('peek → -1 (no buffered-byte store in the poll API)', () => {
    expect(lowerUart({ operation: 'uart.peek', port: 'UART0' } as any))
      .toEqual({ expression: '(-1)' });
  });

  it('available → 0 (poll API cannot count without draining)', () => {
    expect(lowerUart({ operation: 'uart.available', port: 'UART0' } as any))
      .toEqual({ expression: '(0)' });
  });

  it('flush → no-op (poll_out is synchronous)', () => {
    expect(lowerUart({ operation: 'uart.flush', port: 'UART0' } as any))
      .toEqual({ code: '(void)__tc_uart0_dev;' });
  });
});
