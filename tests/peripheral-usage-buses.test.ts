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

    it('detects I2C bus usage in function scope', () => {
      const usage = analyzeUsage(`
        import { I2C0 } from '@typehal/framework-arduino/arduino';
        function readSensor(): number {
          I2C0.begin();
          I2C0.requestFrom(0x76, 2);
          return I2C0.read();
        }
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

    it('detects SPI usage in class methods', () => {
      const usage = analyzeUsage(`
        import { SPI0 } from '@typehal/framework-arduino/arduino';
        class SPIDevice {
          transfer(data: number): number {
            return SPI0.transfer(data);
          }
        }
      `);

      expect(usage.spi).toBe(true);
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
        import { A0, D9 } from '@typehal/board-arduino-uno';

        UART0.begin(9600);
        I2C0.begin();

        const adc = A0.read();
        D9.write(128);
      `);

      expect(usage.adc).toBe(true);
      expect(usage.i2c).toBe(true);
      expect(usage.uart).toBe(true);
      expect(usage.pinsUsed.has('D9')).toBe(true);
    });
  });
});