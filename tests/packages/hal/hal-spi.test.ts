// ---------------------------------------------------------------------------
// HAL SPI Bus Tests
//
// Tests for SPI Arduino-compatible API
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { expectCppContains, expectCppNotContains, transpileArduino } from '../../setup';

describe('SPI HAL - Arduino API Transpilation', () => {
  describe('Initialization', () => {
    it('transpiles SPI0.begin()', () => {
      const result = transpileArduino(`
        import { SPI0 } from '@typecad/framework-arduino/arduino';
        SPI0.begin();
      `);

      expectCppContains(result, ['SPI.begin()']);
      // Note: <SPI.h> include is not auto-injected by the inline evaluator;
      // it relies on Arduino.h pulling it in transitively.
    });

    it('transpiles SPI0.end()', () => {
      const result = transpileArduino(`
        import { SPI0 } from '@typecad/framework-arduino/arduino';
        SPI0.begin();
        SPI0.end();
      `);
      
      expectCppContains(result, ['SPI.end()']);
    });
  });

  describe('Configuration', () => {
    it('transpiles setMode()', () => {
      const result = transpileArduino(`
        import { SPI0 } from '@typecad/framework-arduino/arduino';
        SPI0.begin();
        SPI0.setMode(0);
      `);
      
      expect(result.cpp).toMatch(/SPI\.setDataMode\((SPI_MODE)?0\)/);
    });

    it('transpiles setBitOrder()', () => {
      const result = transpileArduino(`
        import { SPI0 } from '@typecad/framework-arduino/arduino';
        SPI0.begin();
        SPI0.setBitOrder('msb');
      `);

      expect(result.cpp).toMatch(/SPI\.setBitOrder\((MSBFIRST|LSBFIRST|SPI_MSBFIRST)\)/);
    });

    it('transpiles setFrequency()', () => {
      const result = transpileArduino(`
        import { SPI0 } from '@typecad/framework-arduino/arduino';
        SPI0.begin();
        SPI0.setFrequency(1000000);
      `);
      
      expect(result.cpp).toContain('SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0))');
    });
  });

  describe('Transactions', () => {
    it('transpiles beginTransaction/endTransaction', () => {
      const result = transpileArduino(`
        import { SPI0, SPISettings } from '@typecad/framework-arduino/arduino';
        SPI0.begin();
        SPI0.beginTransaction({ frequency: 1000000, mode: 0, bitOrder: 'msb' });
        SPI0.transfer(0xFF);
        SPI0.endTransaction();
      `);

      expectCppContains(result, ['SPI.beginTransaction', 'SPI.endTransaction()']);
      // The object literal is rendered as a C++ aggregate initializer
      expect(result.cpp).toContain('SPI.transfer(255)');
    });
  });

  describe('Transfer Operations', () => {
    it('transpiles single byte transfer', () => {
      const result = transpileArduino(`
        import { SPI0 } from '@typecad/framework-arduino/arduino';
        SPI0.begin();
        const data = SPI0.transfer(0xFF);
      `);
      
      expectCppContains(result, ['SPI.transfer(255)']);
    });

    it('transpiles write (transfer ignoring return)', () => {
      const result = transpileArduino(`
        import { SPI0 } from '@typecad/framework-arduino/arduino';
        SPI0.begin();
        SPI0.write(0xFF);
      `);
      
      expectCppContains(result, ['SPI.transfer(255)']);
    });

    it('transpiles write16', () => {
      const result = transpileArduino(`
        import { SPI0 } from '@typecad/framework-arduino/arduino';
        SPI0.begin();
        SPI0.write16(0xABCD);
      `);

      expectCppContains(result, ['SPI.transfer16']);
    });

    // readRegister() returns a buffer of statically-known size (the count arg).
    // It must lower to a real C array the caller can index AND query .length on
    // — mirroring I2CDevice.readBytes. Previously the body emitted
    // `static uint8_t __spi_buf[N]; ...; return __spi_buf;` via rawCpp, which
    // decayed to a pointer on return and broke `reg.length` (→ reg.size()).
    it('readRegister result is a real C array whose .length resolves to the count', () => {
      const result = transpileArduino(`
        import { SPI0, D10 } from '@typecad/framework-arduino/arduino';
        SPI0.begin();
        const dev = SPI0.device(D10);
        const reg = dev.readRegister(0x80, 4);
        const n = reg.length;
        const first = reg[0];
      `);

      expect(result.cpp).toMatch(/uint8_t\s+reg\s*\[/);
      expect(result.cpp).not.toMatch(/__spi_buf/);
      expect(result.cpp).not.toMatch(/auto\s+reg/);
      expect(result.cpp).not.toMatch(/const\s+uint8_t\s+reg/);
      expectCppContains(result, ['digitalWrite(10, LOW)', 'SPI.transfer(128)', 'digitalWrite(10, HIGH)']);
      expect(result.cpp).toMatch(/reg\[__i\]\s*=\s*SPI\.transfer\(0\)/);
      expect(result.cpp).toContain('sizeof(reg) / sizeof(reg[0])');
      expect(result.cpp).not.toMatch(/reg\.size\(\)/);
    });

    // The buffer var_decl must precede the read loop inside a function body.
    it('readRegister buffer is declared before the read loop inside a function', () => {
      const result = transpileArduino(`
        import { SPI0, D10 } from '@typecad/framework-arduino/arduino';
        function readReg(): number {
          const reg = SPI0.device(D10).readRegister(0x80, 4);
          return reg.length;
        }
        SPI0.begin();
        const v = readReg();
      `);

      const declIdx = result.cpp.indexOf('uint8_t reg[]');
      const fillIdx = result.cpp.indexOf('reg[__i] = SPI.transfer(0)');
      expect(declIdx).not.toBe(-1);
      expect(fillIdx).not.toBe(-1);
      expect(declIdx).toBeLessThan(fillIdx);
    });
  });
});

describe('SPI HAL - Multiple Bus Support', () => {
  it('lowers the high-level SPI API to SPI calls on Arduino Uno', () => {
    const result = transpileArduino(`
      import { SPI0 } from '@typecad/framework-arduino/arduino';
      SPI0.begin();
    `);
    
    expectCppContains(result, ['SPI.begin()']);
    expect(result.cpp).not.toContain('SPI0.begin');
  });
});

// ---------------------------------------------------------------------------
// Two-step SPI device pattern: const dev = bus.device(cs); dev.method()
//
// Like the I2C device pattern, this stores the device in a variable and calls
// methods on it later. The CS pin must resolve to its numeric pin number
// (e.g. D10 → 10) so digitalWrite(10, LOW/HIGH) is emitted, not digitalWrite(D10, ...).
// ---------------------------------------------------------------------------

describe('SPI HAL - Two-step device variable pattern', () => {
  it('resolves display.transfer via const display = bus.device(D10)', () => {
    const result = transpileArduino(`
      import { SPI0, D10 } from '@typecad/framework-arduino/arduino';
      const bus = SPI0.begin();
      const display = bus.device(D10);
      const response = display.transfer(0x42);
    `);

    expectCppContains(result, [
      'SPI.begin()',
      'digitalWrite(10, LOW)',
      'SPI.transfer(66)',
      'digitalWrite(10, HIGH)',
    ]);
    // D10 must resolve to 10 — not stay as the identifier 'D10'
    expect(result.cpp).not.toContain('digitalWrite(D10');
    expectCppNotContains(result, ['this->_cs', 'this->_bus']);
  });

  it('resolves display.writeRegister via const display = bus.device(D10)', () => {
    const result = transpileArduino(`
      import { SPI0, D10 } from '@typecad/framework-arduino/arduino';
      const bus = SPI0.begin();
      const display = bus.device(D10);
      display.writeRegister(0x01, 0xFF);
    `);

    expectCppContains(result, [
      'digitalWrite(10, LOW)',
      'SPI.transfer(1)',
      'SPI.transfer(255)',
      'digitalWrite(10, HIGH)',
    ]);
    expect(result.cpp).not.toContain('digitalWrite(D10');
    expectCppNotContains(result, ['this->_cs', 'this->_bus']);
  });

  it('resolves display with numeric CS pin', () => {
    const result = transpileArduino(`
      import { SPI0 } from '@typecad/framework-arduino/arduino';
      const bus = SPI0.begin();
      const display = bus.device(10);
      display.transfer(0x42);
    `);

    expectCppContains(result, [
      'digitalWrite(10, LOW)',
      'SPI.transfer(66)',
      'digitalWrite(10, HIGH)',
    ]);
    expectCppNotContains(result, ['this->_cs']);
  });
});
