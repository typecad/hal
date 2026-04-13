// ---------------------------------------------------------------------------
// Tests for Phase 1 (GPIO Object-Creation) and Phase 2 (Bus Ownership) examples
//
// Verifies that the new syntax patterns produce correct C++ output.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpile } from './setup';

// ---------------------------------------------------------------------------
// Phase 1: GPIO Object-Creation Pattern
// ---------------------------------------------------------------------------
describe('GPIO Object-Creation Pattern (Phase 1)', () => {
  describe('asOutput()', () => {
    it('emits pinMode OUTPUT for LED.asOutput()', () => {
      const result = transpile(`
        import { LED } from '@typecode/board-arduino-uno/arduino';
        const led = LED.asOutput();
        led.toggle();
      `, { target: 'arduino' });

      expect(result.cpp).toContain('pinMode(13, OUTPUT)');
      expect(result.cpp).toContain('digitalWrite(13, !digitalRead(13))');
    });

    it('emits pinMode + digitalWrite for LED.asOutput(true)', () => {
      const result = transpile(`
        import { LED } from '@typecode/board-arduino-uno/arduino';
        const led = LED.asOutput(true);
        led.toggle();
      `, { target: 'arduino' });

      expect(result.cpp).toContain('pinMode(13, OUTPUT)');
      expect(result.cpp).toContain('digitalWrite(13, true)');
    });

    it('emits pinMode for D9.asOutput() and alias resolves for high()/low()', () => {
      const result = transpile(`
        import { D9 } from '@typecode/board-arduino-uno/arduino';
        const buzzer = D9.asOutput();
        buzzer.high();
        buzzer.low();
      `, { target: 'arduino' });

      expect(result.cpp).toContain('pinMode(9, OUTPUT)');
      expect(result.cpp).toContain('digitalWrite(9, HIGH)');
      expect(result.cpp).toContain('digitalWrite(9, LOW)');
    });

    it('resolves alias inside while loop', () => {
      const result = transpile(`
        import { LED, D2, delay } from '@typecode/board-arduino-uno/arduino';
        const led = LED.asOutput();
        const btn = D2.asInput();
        while (true) {
          if (!btn.read()) {
            led.toggle();
          }
          delay(100);
        }
      `, { target: 'arduino' });

      expect(result.cpp).toContain('pinMode(13, OUTPUT)');
      expect(result.cpp).toContain('pinMode(2, INPUT)');
      // Alias 'led' should resolve to pin 13 inside the loop
      expect(result.cpp).toContain('digitalRead(2)');
      expect(result.cpp).toContain('digitalWrite(13, !digitalRead(13))');
    });
  });

  describe('asInput()', () => {
    it('emits pinMode INPUT for D2.asInput()', () => {
      const result = transpile(`
        import { D2 } from '@typecode/board-arduino-uno/arduino';
        const button = D2.asInput();
        const val = button.read();
      `, { target: 'arduino' });

      expect(result.cpp).toContain('pinMode(2, INPUT)');
      expect(result.cpp).toContain('digitalRead(2)');
    });
  });

  describe('asInputPullUp()', () => {
    it('emits pinMode INPUT_PULLUP for D3.asInputPullUp()', () => {
      const result = transpile(`
        import { D3 } from '@typecode/board-arduino-uno/arduino';
        const btn = D3.asInputPullUp();
        const val = btn.read();
      `, { target: 'arduino' });

      expect(result.cpp).toContain('pinMode(3, INPUT_PULLUP)');
      expect(result.cpp).toContain('digitalRead(3)');
    });
  });

  describe('Multiple pins with aliases', () => {
    it('tracks multiple aliases independently', () => {
      const result = transpile(`
        import { LED, D2, D9, delay } from '@typecode/board-arduino-uno/arduino';
        const led = LED.asOutput();
        const button = D2.asInput();
        const buzzer = D9.asOutput();
        while (true) {
          if (!button.read()) {
            led.toggle();
          }
          buzzer.high();
          delay(100);
        }
      `, { target: 'arduino' });

      // All pinModes emitted
      expect(result.cpp).toContain('pinMode(13, OUTPUT)');
      expect(result.cpp).toContain('pinMode(2, INPUT)');
      expect(result.cpp).toContain('pinMode(9, OUTPUT)');

      // Aliases resolve correctly
      expect(result.cpp).toContain('digitalRead(2)');
      expect(result.cpp).toContain('digitalWrite(13, !digitalRead(13))');
      expect(result.cpp).toContain('digitalWrite(9, HIGH)');
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 2: Bus Ownership Pattern
// ---------------------------------------------------------------------------
describe('Bus Ownership Pattern (Phase 2)', () => {
  describe('I2C ownership', () => {
    it('emits comment for I2C0.take() and I2C0.release()', () => {
      const result = transpile(`
        import { I2C0 } from '@typecode/board-arduino-uno/arduino';
        I2C0.begin();
        I2C0.take();
        I2C0.beginTransmission(0x76);
        I2C0.write(0xFA);
        I2C0.endTransmission();
        I2C0.release();
      `, { target: 'arduino' });

      expect(result.cpp).toContain('Wire.begin()');
      expect(result.cpp).toContain('/* I2C0.take() */');
      expect(result.cpp).toContain('Wire.beginTransmission(118)');
      expect(result.cpp).toContain('Wire.write(250)');
      expect(result.cpp).toContain('/* I2C0.release() */');
    });

    it('generates error for double take without release', () => {
      const result = transpile(`
        import { I2C0 } from '@typecode/board-arduino-uno/arduino';
        I2C0.begin();
        I2C0.take();
        I2C0.take();
      `, { target: 'arduino' });

      const errors = result.diagnostics.filter(
        (d: any) => d.code === 'peripheral-double-take'
      );
      expect(errors.length).toBe(1);
      expect(errors[0].severity).toBe('error');
    });

    it('generates warning for I/O without ownership', () => {
      const result = transpile(`
        import { I2C0 } from '@typecode/board-arduino-uno/arduino';
        I2C0.begin();
        I2C0.take();
        I2C0.release();
        I2C0.write(0x42);
      `, { target: 'arduino' });

      const warnings = result.diagnostics.filter(
        (d: any) => d.code === 'peripheral-io-without-ownership'
      );
      expect(warnings.length).toBe(1);
    });

    it('generates warning for release without take', () => {
      const result = transpile(`
        import { I2C0 } from '@typecode/board-arduino-uno/arduino';
        I2C0.begin();
        I2C0.release();
      `, { target: 'arduino' });

      const warnings = result.diagnostics.filter(
        (d: any) => d.code === 'peripheral-release-without-take'
      );
      expect(warnings.length).toBe(1);
      expect(warnings[0].severity).toBe('warning');
    });
  });

  describe('SPI ownership', () => {
    it('emits comment for SPI0.take() and SPI0.release()', () => {
      const result = transpile(`
        import { SPI0 } from '@typecode/board-arduino-uno/arduino';
        SPI0.begin();
        SPI0.take();
        SPI0.transfer(0x42);
        SPI0.release();
      `, { target: 'arduino' });

      expect(result.cpp).toContain('SPI.begin()');
      expect(result.cpp).toContain('/* SPI0.take() */');
      expect(result.cpp).toContain('SPI.transfer(66)');
      expect(result.cpp).toContain('/* SPI0.release() */');
    });
  });

  describe('UART ownership', () => {
    it('emits comment for UART0.take() and UART0.release()', () => {
      const result = transpile(`
        import { UART0 } from '@typecode/board-arduino-uno/arduino';
        UART0.begin(9600);
        UART0.take();
        UART0.println("hello");
        UART0.release();
      `, { target: 'arduino' });

      expect(result.cpp).toContain('Serial.begin(9600)');
      expect(result.cpp).toContain('/* UART0.take() */');
      expect(result.cpp).toContain('Serial.println("hello")');
      expect(result.cpp).toContain('/* UART0.release() */');
    });
  });

  describe('Opt-in behavior', () => {
    it('no diagnostics when ownership pattern is not used', () => {
      const result = transpile(`
        import { I2C0 } from '@typecode/board-arduino-uno/arduino';
        I2C0.begin();
        I2C0.beginTransmission(0x76);
        I2C0.write(0xFA);
        I2C0.endTransmission();
      `, { target: 'arduino' });

      const ownershipDiagnostics = result.diagnostics.filter(
        (d: any) => d.source === 'peripheral-ownership'
      );
      expect(ownershipDiagnostics.length).toBe(0);
    });

    it('no diagnostics when take/release used correctly', () => {
      const result = transpile(`
        import { I2C0 } from '@typecode/board-arduino-uno/arduino';
        I2C0.begin();
        I2C0.take();
        I2C0.beginTransmission(0x76);
        I2C0.write(0xFA);
        I2C0.endTransmission();
        I2C0.release();
      `, { target: 'arduino' });

      const ownershipDiagnostics = result.diagnostics.filter(
        (d: any) => d.source === 'peripheral-ownership'
      );
      expect(ownershipDiagnostics.length).toBe(0);
    });
  });

  describe('Take/release in loop', () => {
    it('correctly validates take/release across loop iterations', () => {
      const result = transpile(`
        import { I2C0, delay } from '@typecode/board-arduino-uno/arduino';
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

      // No diagnostics — take/release balanced in each iteration
      const ownershipDiagnostics = result.diagnostics.filter(
        (d: any) => d.source === 'peripheral-ownership'
      );
      expect(ownershipDiagnostics.length).toBe(0);

      // C++ output is correct
      expect(result.cpp).toContain('/* I2C0.take() */');
      expect(result.cpp).toContain('/* I2C0.release() */');
      expect(result.cpp).toContain('Wire.beginTransmission(118)');
    });
  });
});

// ---------------------------------------------------------------------------
// Combined: GPIO Object-Creation + Bus Ownership
// ---------------------------------------------------------------------------
describe('Combined GPIO + Bus Ownership', () => {
  it('handles both patterns in the same program', () => {
    const result = transpile(`
      import { LED, I2C0, UART0, delay } from '@typecode/board-arduino-uno/arduino';
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

    // GPIO object-creation
    expect(result.cpp).toContain('pinMode(13, OUTPUT)');

    // Bus ownership
    expect(result.cpp).toContain('/* I2C0.take() */');
    expect(result.cpp).toContain('/* I2C0.release() */');

    // UART begin
    expect(result.cpp).toContain('Serial.begin(9600)');

    // No ownership diagnostics
    const ownershipDiagnostics = result.diagnostics.filter(
      (d: any) => d.source === 'peripheral-ownership'
    );
    expect(ownershipDiagnostics.length).toBe(0);
  });
});
