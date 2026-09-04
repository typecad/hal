import { describe, it, expect } from 'vitest';
import { TEST_CHIP } from '../helpers/test-chip';
import { lowerUart, uartInitLines } from '../../../../packages/framework-zephyr/src/lowering/uart';


describe('legacy UART op removal + surviving poll/IRQ surface', () => {
  it('uart.poll_write applies the baud once then poll_outs the string', () => {
    const out = lowerUart({ operation: 'uart.poll_write', port: 'UART0', baud: 9600, data: '"AT"' } as any);
    expect(out.code).toContain('__tc_uart0_baud_done');
    expect(out.code).toContain('__tc_dev_put(__tc_uart0_dev, "AT");');
  });
});
