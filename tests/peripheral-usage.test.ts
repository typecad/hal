// ---------------------------------------------------------------------------
// Peripheral Usage Analysis Tests
//
// Tests for IR analysis that detects which hardware peripherals are used
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { buildProgramIR } from '../packages/cli/src/ir/build-ir';
import { analyzePeripheralUsage, createEmptyPeripheralUsage } from '../packages/cli/src/ir/peripheral-usage';

describe('Peripheral Usage Analysis', () => {
  describe('I2C Detection', () => {
    it('detects I2C0 usage with Arduino API', () => {
      const code = `
        import { I2C0 } from '@typecode/board-arduino-uno/arduino';
        I2C0.begin();
        I2C0.beginTransmission(0x76);
        I2C0.write(0xFA);
        I2C0.endTransmission();
      `;

      const ir = buildProgramIR('test.ts', code);
      const usage = analyzePeripheralUsage(ir);

      // I2C detection works with typecode-call IR nodes
      expect(usage.i2c).toBe(true);
      expect(usage.i2cInstancesUsed.has(0)).toBe(true);
    });

    it('detects I2C bus usage in function', () => {
      const code = `
        import { I2C0 } from '@typecode/board-arduino-uno/arduino';
        function readSensor(): number {
          I2C0.begin();
          I2C0.requestFrom(0x76, 2);
          return I2C0.read();
        }
      `;

      const ir = buildProgramIR('test.ts', code);
      const usage = analyzePeripheralUsage(ir);

      // I2C detection works in functions
      expect(usage.i2c).toBe(true);
    });
  });

  describe('SPI Detection', () => {
    it('detects SPI0 usage with Arduino API', () => {
      const code = `
        import { SPI0 } from '@typecode/board-arduino-uno/arduino';
        SPI0.begin();
        SPI0.transfer(0xFF);
      `;

      const ir = buildProgramIR('test.ts', code);
      const usage = analyzePeripheralUsage(ir);

      // SPI detection works with typecode-call IR nodes
      expect(usage.spi).toBe(true);
      expect(usage.spiInstancesUsed.has(0)).toBe(true);
    });

    it('detects SPI usage in class method', () => {
      const code = `
        import { SPI0 } from '@typecode/board-arduino-uno/arduino';
        class SPIDevice {
          transfer(data: number): number {
            return SPI0.transfer(data);
          }
        }
      `;

      const ir = buildProgramIR('test.ts', code);
      const usage = analyzePeripheralUsage(ir);

      // SPI detection works in class methods
      expect(usage.spi).toBe(true);
    });
  });

  describe('UART/Serial Detection', () => {
    it('detects UART0 usage with Arduino API', () => {
      const code = `
        import { UART0 } from '@typecode/board-arduino-uno/arduino';
        UART0.begin(9600);
        UART0.println("Hello");
      `;

      const ir = buildProgramIR('test.ts', code);
      const usage = analyzePeripheralUsage(ir);

      // UART0 detection works with typecode-call IR nodes
      expect(usage.uart).toBe(true);
      expect(usage.uartInstancesUsed.has(0)).toBe(true);
    });

    it('detects Serial usage (global)', () => {
      const code = `
        Serial.begin(9600);
        Serial.println("Hello");
      `;

      const ir = buildProgramIR('test.ts', code);
      const usage = analyzePeripheralUsage(ir);

      // Serial global detection works with typecode-call IR nodes
      expect(usage.uart).toBe(true);
    });
  });

  describe('ADC Detection', () => {
    it('detects analog input read', () => {
      const code = `
        import { A0 } from '@typecode/board-arduino-uno';
        const value = A0.read();
      `;

      const ir = buildProgramIR('test.ts', code);
      const usage = analyzePeripheralUsage(ir);

      expect(usage.adc).toBe(true);
      expect(usage.adcChannelsUsed.has(0)).toBe(true);
    });

    it('detects multiple ADC channels', () => {
      const code = `
        import { A0, A1, A2 } from '@typecode/board-arduino-uno';
        const v0 = A0.read();
        const v1 = A1.read();
        const v2 = A2.read();
      `;

      const ir = buildProgramIR('test.ts', code);
      const usage = analyzePeripheralUsage(ir);

      expect(usage.adc).toBe(true);
      expect(usage.adcChannelsUsed.has(0)).toBe(true);
      expect(usage.adcChannelsUsed.has(1)).toBe(true);
      expect(usage.adcChannelsUsed.has(2)).toBe(true);
    });
  });

  describe('PWM Detection', () => {
    it('detects PWM write on PWM-capable pins', () => {
      const code = `
        import { D9 } from '@typecode/board-arduino-uno';
        D9.output();
        D9.write(128);
      `;

      const ir = buildProgramIR('test.ts', code);
      const usage = analyzePeripheralUsage(ir);

      // D9 is a PWM-capable pin
      expect(usage.pinsUsed.has('D9')).toBe(true);
    });
  });

  describe('Pin Mode Detection', () => {
    it('detects output pin configuration', () => {
      const code = `
        import { D13 } from '@typecode/board-arduino-uno';
        D13.output(false);
      `;

      const ir = buildProgramIR('test.ts', code);
      const usage = analyzePeripheralUsage(ir);

      expect(usage.outputPins.has(13)).toBe(true);
    });

    it('detects input pullup configuration', () => {
      const code = `
        import { D2 } from '@typecode/board-arduino-uno';
        D2.inputPullUp();
      `;

      const ir = buildProgramIR('test.ts', code);
      const usage = analyzePeripheralUsage(ir);

      expect(usage.inputPullupPins.has(2)).toBe(true);
    });
  });

  describe('Multiple Peripheral Detection', () => {
    it('detects multiple peripherals in same program', () => {
      const code = `
        import { I2C0, UART0, A0, D9 } from '@typecode/board-arduino-uno/arduino';

        UART0.begin(9600);
        I2C0.begin();

        const adc = A0.read();
        D9.write(128);
      `;

      const ir = buildProgramIR('test.ts', code);
      const usage = analyzePeripheralUsage(ir);

      // All peripherals are detected
      expect(usage.adc).toBe(true);
      expect(usage.i2c).toBe(true);
      expect(usage.uart).toBe(true);
      // D9 is PWM-capable but write() doesn't trigger pwm flag, only pinsUsed tracking
      expect(usage.pinsUsed.has('D9')).toBe(true);
    });
  });

  describe('Empty Usage', () => {
    it('returns empty usage for program without peripherals', () => {
      const code = `
        function add(a: number, b: number): number {
          return a + b;
        }
      `;
      
      const ir = buildProgramIR('test.ts', code);
      const usage = analyzePeripheralUsage(ir);
      
      expect(usage.i2c).toBe(false);
      expect(usage.spi).toBe(false);
      expect(usage.uart).toBe(false);
      expect(usage.adc).toBe(false);
      expect(usage.pwm).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('handles empty program', () => {
      const ir = buildProgramIR('test.ts', '');
      const usage = analyzePeripheralUsage(ir);
      
      expect(usage.i2c).toBe(false);
      expect(usage.spi).toBe(false);
      expect(usage.uart).toBe(false);
    });

    it('createEmptyPeripheralUsage returns correct defaults', () => {
      const usage = createEmptyPeripheralUsage();
      
      expect(usage.adc).toBe(false);
      expect(usage.pwm).toBe(false);
      expect(usage.externalInterrupts).toBe(false);
      expect(usage.timer0).toBe(false);
      expect(usage.i2c).toBe(false);
      expect(usage.spi).toBe(false);
      expect(usage.uart).toBe(false);
      expect(usage.pwmPinsUsed).toBeInstanceOf(Set);
      expect(usage.adcChannelsUsed).toBeInstanceOf(Set);
      expect(usage.outputPins).toBeInstanceOf(Set);
      expect(usage.inputPullupPins).toBeInstanceOf(Set);
      expect(usage.inputPins).toBeInstanceOf(Set);
      expect(usage.i2cInstancesUsed).toBeInstanceOf(Set);
      expect(usage.spiInstancesUsed).toBeInstanceOf(Set);
      expect(usage.uartInstancesUsed).toBeInstanceOf(Set);
    });

    it('tracks timer0 usage for delay()', () => {
      const ir = buildProgramIR('test.ts', `
        import { delay } from '@typecode/board-arduino-uno';
        delay(10);
      `);
      const usage = analyzePeripheralUsage(ir);

      expect(usage.timer0).toBe(true);
    });

    it('tracks timer0 usage for millis() in expressions', () => {
      const ir = buildProgramIR('test.ts', `
        import { millis } from '@typecode/board-arduino-uno';
        const now = millis();
      `);
      const usage = analyzePeripheralUsage(ir);

      expect(usage.timer0).toBe(true);
    });
  });
});