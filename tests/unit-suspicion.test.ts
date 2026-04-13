import { describe, expect, it } from 'vitest';
import { transpile } from './setup';

describe('Unit Suspicion Validation', () => {
  it('warns when UART baud rate looks suspicious', () => {
    const result = transpile(`
      import { UART0 } from '@typecode/board-arduino-uno';
      UART0.config.baudRate(9500).begin();
    `, { target: 'arduino' });

    expect(result.diagnostics.some(d => d.code === 'suspicious-baud-rate')).toBe(true);
  });

  it('warns when I2C speed looks like kHz instead of Hz', () => {
    const result = transpile(`
      import { I2C0 } from '@typecode/board-arduino-uno';
      I2C0.config.speed(400).begin();
    `, { target: 'arduino' });

    expect(result.diagnostics.some(d => d.code === 'suspicious-i2c-speed')).toBe(true);
  });

  it('warns when SPI frequency looks like UART baud', () => {
    const result = transpile(`
      import { SPI0 } from '@typecode/board-arduino-uno';
      SPI0.config.frequency(9600).begin();
    `, { target: 'arduino' });

    expect(result.diagnostics.some(d => d.code === 'suspicious-spi-frequency')).toBe(true);
  });
});