// ---------------------------------------------------------------------------
// Peripheral Usage Analysis Tests: Bus Detection
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { analyzeUsage } from './setup';

describe('Peripheral Usage Analysis - Bus Detection', () => {
  describe('I2C Detection', () => {
    it('detects I2C0 usage with Arduino API', () => {
      const usage = analyzeUsage(`
        import { I2C0 } from '@typehal/framework-arduino/arduino';
        I2C0.begin();
        I2C0.beginTransmission(0x76);
        I2C0.write(0xFA);
        I2C0.endTransmission();
      `);

      expect(usage.i2c).toBe(true);
      expect(usage.i2cInstancesUsed.has(0)).toBe(true);
    });

    it('detects I2C bus usage from __EMIT__ nodes', () => {
      // I2C usage at top level produces __EMIT__ nodes with Wire.begin() etc.
      const usage = analyzeUsage(`
        import { I2C0 } from '@typehal/framework-arduino/arduino';
        I2C0.begin();
        I2C0.requestFrom(0x76, 2);
      `);

      expect(usage.i2c).toBe(true);
    });
  });

  describe('SPI Detection', () => {
    it('detects SPI0 usage with Arduino API', () => {
      const usage = analyzeUsage(`
        import { SPI0 } from '@typehal/framework-arduino/arduino';
        SPI0.begin();
        SPI0.transfer(0xFF);
      `);

      expect(usage.spi).toBe(true);
      expect(usage.spiInstancesUsed.has(0)).toBe(true);
    });
  });

  describe('UART Detection', () => {
    it('detects UART0 usage with Arduino API', () => {
      const usage = analyzeUsage(`
        import { UART0 } from '@typehal/framework-arduino/arduino';
        UART0.begin(9600);
        UART0.println("Hello");
      `);

      expect(usage.uart).toBe(true);
      expect(usage.uartInstancesUsed.has(0)).toBe(true);
    });

    it('detects global Serial usage', () => {
      const usage = analyzeUsage(`
        Serial.begin(9600);
        Serial.println("Hello");
      `);

      expect(usage.uart).toBe(true);
    });
  });

  describe('Multiple Peripheral Detection', () => {
    it('detects multiple peripherals in the same program', () => {
      const usage = analyzeUsage(`
        import { I2C0, UART0 } from '@typehal/framework-arduino/arduino';
        import { D9 } from '@typehal/board-arduino-uno';

        UART0.begin(9600);
        I2C0.begin();

        D9.asOutput();
        D9.pwm(128);
      `);

      expect(usage.pwm).toBe(true);
      expect(usage.i2c).toBe(true);
      expect(usage.uart).toBe(true);
    });
  });
});
