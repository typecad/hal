// ---------------------------------------------------------------------------
// Bus Ownership Pattern Tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { expectCppContains, findDiagnostics, transpile } from './setup';

describe('Bus Ownership Pattern', () => {
  describe('I2C ownership', () => {
    it('emits comment for I2C0.take() and I2C0.release()', () => {
      const result = transpile(`
        import { I2C0 } from '@typehal/board-arduino-uno/arduino';
        I2C0.begin();
        I2C0.take();
        I2C0.beginTransmission(0x76);
        I2C0.write(0xFA);
        I2C0.endTransmission();
        I2C0.release();
      `, { target: 'arduino' });

      expectCppContains(result, [
        'Wire.begin()',
        '/* I2C0.take() */',
        'Wire.beginTransmission(118)',
        'Wire.write(250)',
        '/* I2C0.release() */',
      ]);
    });

    it('generates error for double take without release', () => {
      const result = transpile(`
        import { I2C0 } from '@typehal/board-arduino-uno/arduino';
        I2C0.begin();
        I2C0.take();
        I2C0.take();
      `, { target: 'arduino' });

      const errors = findDiagnostics(result, 'peripheral-double-take');
      expect(errors.length).toBe(1);
      expect(errors[0].severity).toBe('error');
    });

    it('generates warning for I/O without ownership', () => {
      const result = transpile(`
        import { I2C0 } from '@typehal/board-arduino-uno/arduino';
        I2C0.begin();
        I2C0.take();
        I2C0.release();
        I2C0.write(0x42);
      `, { target: 'arduino' });

      const warnings = findDiagnostics(result, 'peripheral-io-without-ownership');
      expect(warnings.length).toBe(1);
    });

    it('generates warning for release without take', () => {
      const result = transpile(`
        import { I2C0 } from '@typehal/board-arduino-uno/arduino';
        I2C0.begin();
        I2C0.release();
      `, { target: 'arduino' });

      const warnings = findDiagnostics(result, 'peripheral-release-without-take');
      expect(warnings.length).toBe(1);
      expect(warnings[0].severity).toBe('warning');
    });
  });

  describe('SPI ownership', () => {
    it('emits comment for SPI0.take() and SPI0.release()', () => {
      const result = transpile(`
        import { SPI0 } from '@typehal/board-arduino-uno/arduino';
        SPI0.begin();
        SPI0.take();
        SPI0.transfer(0x42);
        SPI0.release();
      `, { target: 'arduino' });

      expectCppContains(result, [
        'SPI.begin()',
        '/* SPI0.take() */',
        'SPI.transfer(66)',
        '/* SPI0.release() */',
      ]);
    });
  });

  describe('UART ownership', () => {
    it('emits comment for UART0.take() and UART0.release()', () => {
      const result = transpile(`
        import { UART0 } from '@typehal/board-arduino-uno/arduino';
        UART0.begin(9600);
        UART0.take();
        UART0.println("hello");
        UART0.release();
      `, { target: 'arduino' });

      expectCppContains(result, [
        'Serial.begin(9600)',
        '/* UART0.take() */',
        'Serial.println("hello")',
        '/* UART0.release() */',
      ]);
    });
  });

  describe('Opt-in behavior', () => {
    it('no diagnostics when ownership pattern is not used', () => {
      const result = transpile(`
        import { I2C0 } from '@typehal/board-arduino-uno/arduino';
        I2C0.begin();
        I2C0.beginTransmission(0x76);
        I2C0.write(0xFA);
        I2C0.endTransmission();
      `, { target: 'arduino' });

      const ownershipDiagnostics = result.diagnostics.filter(
        (diagnostic) => diagnostic.source === 'peripheral-ownership'
      );
      expect(ownershipDiagnostics.length).toBe(0);
    });

    it('no diagnostics when take/release used correctly', () => {
      const result = transpile(`
        import { I2C0 } from '@typehal/board-arduino-uno/arduino';
        I2C0.begin();
        I2C0.take();
        I2C0.beginTransmission(0x76);
        I2C0.write(0xFA);
        I2C0.endTransmission();
        I2C0.release();
      `, { target: 'arduino' });

      const ownershipDiagnostics = result.diagnostics.filter(
        (diagnostic) => diagnostic.source === 'peripheral-ownership'
      );
      expect(ownershipDiagnostics.length).toBe(0);
    });
  });

  describe('Take/release in loop', () => {
    it('correctly validates take/release across loop iterations', () => {
      const result = transpile(`
        import { I2C0, delay } from '@typehal/board-arduino-uno/arduino';
        I2C0.begin();
        while (true) {
          I2C0.take();
          I2C0.beginTransmission(0x76);
          I2C0.write(0xFA);
          I2C0.endTransmission();
          I2C0.release();
          delay(1000);
        }
      `, { target: 'arduino' });

      const ownershipDiagnostics = result.diagnostics.filter(
        (diagnostic) => diagnostic.source === 'peripheral-ownership'
      );
      expect(ownershipDiagnostics.length).toBe(0);

      expectCppContains(result, [
        '/* I2C0.take() */',
        '/* I2C0.release() */',
        'Wire.beginTransmission(118)',
      ]);
    });
  });
});

describe('Combined GPIO + Bus Ownership', () => {
  it('handles both patterns in the same program', () => {
    const result = transpile(`
      import { LED, I2C0, UART0, delay } from '@typehal/board-arduino-uno/arduino';
      const led = LED.asOutput();
      const serial = UART0.begin(9600);
      I2C0.begin();
      I2C0.take();
      I2C0.beginTransmission(0x76);
      I2C0.write(0xFA);
      I2C0.endTransmission();
      I2C0.release();
      while (true) {
        led.toggle();
        serial.println("tick");
        delay(1000);
      }
    `, { target: 'arduino' });

    expectCppContains(result, [
      'pinMode(13, OUTPUT)',
      '/* I2C0.take() */',
      '/* I2C0.release() */',
      'Serial.begin(9600)',
    ]);

    const ownershipDiagnostics = result.diagnostics.filter(
      (diagnostic) => diagnostic.source === 'peripheral-ownership'
    );
    expect(ownershipDiagnostics.length).toBe(0);
  });
});