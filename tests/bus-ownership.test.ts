// ---------------------------------------------------------------------------
// Bus Ownership Pattern Tests
//
// The bus ownership pattern (take()/release()) is emitted as regular C++ calls
// in the __EMIT__ system. The ownership validator previously relied on
// typehal-call IR nodes which no longer exist. These tests verify that the
// correct C++ output is produced and no false diagnostics are generated.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { expectCppContains, transpile } from './setup';

describe('Bus Ownership Pattern', () => {
  describe('I2C ownership', () => {
    it('emits I2C operations with take/release calls', () => {
      const result = transpile(`
        import { I2C0 } from '@typehal/framework-arduino/arduino';
        I2C0.begin();
        I2C0.take();
        I2C0.beginTransmission(0x76);
        I2C0.write(0xFA);
        I2C0.endTransmission();
        I2C0.release();
      `, { target: 'arduino' });

      expectCppContains(result, [
        'Wire.begin()',
        'Wire.beginTransmission(118)',
        'Wire.write(250)',
        'Wire.endTransmission',
      ]);
    });
  });

  describe('SPI ownership', () => {
    it('emits SPI operations with take/release calls', () => {
      const result = transpile(`
        import { SPI0 } from '@typehal/framework-arduino/arduino';
        SPI0.begin();
        SPI0.take();
        SPI0.transfer(0x42);
        SPI0.release();
      `, { target: 'arduino' });

      expectCppContains(result, [
        'SPI.begin()',
        'SPI.transfer(66)',
      ]);
    });
  });

  describe('UART ownership', () => {
    it('emits UART operations with take/release calls', () => {
      const result = transpile(`
        import { UART0 } from '@typehal/framework-arduino/arduino';
        UART0.begin(9600);
        UART0.take();
        UART0.println("hello");
        UART0.release();
      `, { target: 'arduino' });

      expectCppContains(result, [
        'Serial.begin(9600)',
        'Serial.println("hello")',
      ]);
    });
  });

  describe('Opt-in behavior', () => {
    it('no ownership diagnostics when ownership pattern is not used', () => {
      const result = transpile(`
        import { I2C0 } from '@typehal/framework-arduino/arduino';
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

    it('no ownership diagnostics when take/release used correctly', () => {
      const result = transpile(`
        import { I2C0 } from '@typehal/framework-arduino/arduino';
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
    it('emits I2C operations inside while loop', () => {
      const result = transpile(`
        import { I2C0 } from '@typehal/framework-arduino/arduino';
        import { delay } from '@typehal/board-arduino-uno';
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
        'Wire.beginTransmission(118)',
      ]);
    });
  });
});

describe('Combined GPIO + Bus Ownership', () => {
  it('handles both patterns in the same program', () => {
    const result = transpile(`
      import { I2C0, UART0 } from '@typehal/framework-arduino/arduino';
      import { LED, delay } from '@typehal/board-arduino-uno';
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
      'Serial.begin(9600)',
    ]);

    const ownershipDiagnostics = result.diagnostics.filter(
      (diagnostic) => diagnostic.source === 'peripheral-ownership'
    );
    expect(ownershipDiagnostics.length).toBe(0);
  });
});
