import { describe, it, expect, beforeEach } from 'vitest';
import { lowerUart, uartInitLines, parseControllerIndex } from '../../../../packages/framework-esp32/src/lowering/uart';
import { setActiveChip, ESP32 } from '../../../../packages/framework-esp32/src/chips/index';

beforeEach(() => setActiveChip(ESP32));

describe('parseControllerIndex', () => {
  it('parses trailing digit from "UART0"', () => {
    expect(parseControllerIndex('UART0')).toBe(0);
  });
  it('parses "I2C1"', () => {
    expect(parseControllerIndex('I2C1')).toBe(1);
  });
  it('defaults to 0 on undefined', () => {
    expect(parseControllerIndex(undefined)).toBe(0);
  });
  it('defaults to 0 when no trailing digit', () => {
    expect(parseControllerIndex('UART')).toBe(0);
  });
});

describe('uart init block', () => {
  it('emits CUTTLEFISH_UART markers', () => {
    const lines = uartInitLines(0).join('\n');
    expect(lines).toContain('// CUTTLEFISH_UART_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_UART_END');
  });
  it('installs driver on UART_NUM_0', () => {
    expect(uartInitLines(0).join('\n')).toMatch(/uart_driver_install\(UART_NUM_0,/);
  });
});

describe('uart lowering', () => {
  it('begin → __tc_uart0_init(baud)', () => {
    expect(lowerUart({ operation: 'uart.begin', port: 'UART0', baud: 9600 }))
      .toEqual({ code: '__tc_uart0_init(9600);' });
  });
  it('flush → uart_wait_tx_done', () => {
    expect(lowerUart({ operation: 'uart.flush', port: 'UART0' }))
      .toEqual({ code: 'uart_wait_tx_done(UART_NUM_0, portMAX_DELAY);' });
  });
  it('end → uart_driver_delete', () => {
    expect(lowerUart({ operation: 'uart.end', port: 'UART0' }).code)
      .toContain('uart_driver_delete(UART_NUM_0)');
  });
  it('available → buffered length expression', () => {
    const out = lowerUart({ operation: 'uart.available', port: 'UART0' });
    expect(out.expression).toContain('uart_get_buffered_data_len');
  });
  it('unknown uart.* op throws', () => {
    expect(() => lowerUart({ operation: 'uart.unknown', port: 'UART0' } as any)).toThrow(/does not yet support/);
  });
});
