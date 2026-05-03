// ---------------------------------------------------------------------------
// HAL SPI Bus Tests
//
// Tests for SPI Arduino-compatible API
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { expectCppContains, transpileArduino } from '../../setup';

describe('SPI HAL - Arduino API Transpilation', () => {
  describe('Initialization', () => {
    it('transpiles SPI0.begin()', () => {
      const result = transpileArduino(`
        import { SPI0 } from '@typehal/framework-arduino/arduino';
        SPI0.begin();
      `);

      expectCppContains(result, ['SPI.begin()']);
      // Note: <SPI.h> include is not auto-injected by the inline evaluator;
      // it relies on Arduino.h pulling it in transitively.
    });

    it('transpiles SPI0.end()', () => {
      const result = transpileArduino(`
        import { SPI0 } from '@typehal/framework-arduino/arduino';
        SPI0.begin();
        SPI0.end();
      `);
      
      expectCppContains(result, ['SPI.end()']);
    });
  });

  describe('Configuration', () => {
    it('transpiles setMode()', () => {
      const result = transpileArduino(`
        import { SPI0 } from '@typehal/framework-arduino/arduino';
        SPI0.begin();
        SPI0.setMode(0);
      `);
      
      expect(result.cpp).toMatch(/SPI\.setDataMode\((SPI_MODE)?0\)/);
    });

    it('transpiles setBitOrder()', () => {
      const result = transpileArduino(`
        import { SPI0, SPIBitOrder } from '@typehal/framework-arduino/arduino';
        SPI0.begin();
        SPI0.setBitOrder(SPIBitOrder.MSB);
      `);
      
      expect(result.cpp).toMatch(/SPI\.setBitOrder\((SPIBitOrder\.MSB|MSBFIRST|SPI_MSBFIRST)\)/);
    });

    it('transpiles setFrequency()', () => {
      const result = transpileArduino(`
        import { SPI0 } from '@typehal/framework-arduino/arduino';
        SPI0.begin();
        SPI0.setFrequency(1000000);
      `);
      
      expect(result.cpp).toContain('SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0))');
    });
  });

  describe('Transactions', () => {
    it('transpiles beginTransaction/endTransaction', () => {
      const result = transpileArduino(`
        import { SPI0, SPISettings } from '@typehal/framework-arduino/arduino';
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
        import { SPI0 } from '@typehal/framework-arduino/arduino';
        SPI0.begin();
        const data = SPI0.transfer(0xFF);
      `);
      
      expectCppContains(result, ['SPI.transfer(255)']);
    });

    it('transpiles write (transfer ignoring return)', () => {
      const result = transpileArduino(`
        import { SPI0 } from '@typehal/framework-arduino/arduino';
        SPI0.begin();
        SPI0.write(0xFF);
      `);
      
      expectCppContains(result, ['SPI.transfer(255)']);
    });

    it('transpiles write16', () => {
      const result = transpileArduino(`
        import { SPI0 } from '@typehal/framework-arduino/arduino';
        SPI0.begin();
        SPI0.write16(0xABCD);
      `);
      
      expectCppContains(result, ['SPI.transfer16']);
    });
  });
});

describe('SPI HAL - Multiple Bus Support', () => {
  it('lowers the high-level SPI API to SPI calls on Arduino Uno', () => {
    const result = transpileArduino(`
      import { SPI0 } from '@typehal/framework-arduino/arduino';
      SPI0.begin();
    `);
    
    expectCppContains(result, ['SPI.begin()']);
    expect(result.cpp).not.toContain('SPI0.begin');
  });
});
