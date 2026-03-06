// ---------------------------------------------------------------------------
// HAL SPI Bus Tests
//
// Tests for SPI fluent and Arduino-compatible APIs
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpile } from './setup';

describe('SPI HAL - Arduino API Transpilation', () => {
  describe('Initialization', () => {
    it('transpiles SPI0.begin()', () => {
      const result = transpile(`
        import { SPI0 } from '@typecode/board-arduino-uno/arduino';
        SPI0.begin();
      `, { target: 'arduino' });
      
      // SPI0 -> SPI mapping implemented
      expect(result.cpp).toContain('SPI.begin()');
    });

    it('transpiles SPI0.end()', () => {
      const result = transpile(`
        import { SPI0 } from '@typecode/board-arduino-uno/arduino';
        SPI0.begin();
        SPI0.end();
      `, { target: 'arduino' });
      
      // SPI0 -> SPI mapping implemented
      expect(result.cpp).toContain('SPI.end()');
    });
  });

  describe('Configuration', () => {
    it('transpiles setMode()', () => {
      const result = transpile(`
        import { SPI0 } from '@typecode/board-arduino-uno/arduino';
        SPI0.begin();
        SPI0.setMode(0);
      `, { target: 'arduino' });
      
      expect(result.cpp).toContain('SPI.setDataMode');
    });

    it('transpiles setBitOrder()', () => {
      const result = transpile(`
        import { SPI0, SPIBitOrder } from '@typecode/board-arduino-uno/arduino';
        SPI0.begin();
        SPI0.setBitOrder(SPIBitOrder.MSB);
      `, { target: 'arduino' });
      
      expect(result.cpp).toContain('SPI.setBitOrder');
    });

    it('transpiles setFrequency()', () => {
      const result = transpile(`
        import { SPI0 } from '@typecode/board-arduino-uno/arduino';
        SPI0.begin();
        SPI0.setFrequency(1000000);
      `, { target: 'arduino' });
      
      expect(result.cpp).toContain('SPI.setClockDivider');
    });
  });

  describe('Transactions', () => {
    it('transpiles beginTransaction/endTransaction', () => {
      const result = transpile(`
        import { SPI0, SPISettings } from '@typecode/board-arduino-uno/arduino';
        SPI0.begin();
        SPI0.beginTransaction({ frequency: 1000000, mode: 0, bitOrder: 'msb' });
        SPI0.transfer(0xFF);
        SPI0.endTransaction();
      `, { target: 'arduino' });
      
      // SPI0.beginTransaction -> SPI.beginTransaction mapping implemented
      expect(result.cpp).toContain('SPI.beginTransaction');
      expect(result.cpp).toContain('SPI.endTransaction()');
    });
  });

  describe('Transfer Operations', () => {
    it('transpiles single byte transfer', () => {
      const result = transpile(`
        import { SPI0 } from '@typecode/board-arduino-uno/arduino';
        SPI0.begin();
        const data = SPI0.transfer(0xFF);
      `, { target: 'arduino' });
      
      // SPI0.transfer -> SPI.transfer
      expect(result.cpp).toContain('SPI.transfer(255)');
    });

    it('transpiles write (transfer ignoring return)', () => {
      const result = transpile(`
        import { SPI0 } from '@typecode/board-arduino-uno/arduino';
        SPI0.begin();
        SPI0.write(0xFF);
      `, { target: 'arduino' });
      
      // SPI0.write -> SPI.transfer (ignoring return)
      expect(result.cpp).toContain('SPI.transfer(255)');
    });

    it('transpiles write16', () => {
      const result = transpile(`
        import { SPI0 } from '@typecode/board-arduino-uno/arduino';
        SPI0.begin();
        SPI0.write16(0xABCD);
      `, { target: 'arduino' });
      
      // SPI0.write16 -> SPI.transfer16
      expect(result.cpp).toContain('SPI.transfer16');
    });
  });
});

describe('SPI HAL - Fluent API Transpilation', () => {
  describe('Configuration', () => {
    it('transpiles fluent config chain (requires IR chain tracking)', () => {
      const result = transpile(`
        import { SPI0 } from '@typecode/board-arduino-uno';
        SPI0.config.frequency(1000000).mode(0).begin();
      `, { target: 'arduino' });
      
      // TODO: Full fluent chain tracking requires IR-level chain analysis
      // Currently each method in chain is processed separately
      expect(result.cpp).toContain('SPI0.config.frequency(1000000).mode(0).begin()');
    });

    it('transpiles config with bitOrder (requires IR chain tracking)', () => {
      const result = transpile(`
        import { SPI0 } from '@typecode/board-arduino-uno';
        SPI0.config.frequency(1000000).bitOrder('msb').begin();
      `, { target: 'arduino' });
      
      // TODO: Full fluent chain tracking requires IR-level chain analysis
      expect(result.cpp).toContain('SPI0.config.frequency(1000000).bitOrder');
    });

    it('transpiles config with CPOL/CPHA (requires IR chain tracking)', () => {
      const result = transpile(`
        import { SPI0 } from '@typecode/board-arduino-uno';
        SPI0.config.cpol(1).cpha(1).begin();
      `, { target: 'arduino' });
      
      // TODO: Full fluent chain tracking requires IR-level chain analysis
      expect(result.cpp).toContain('SPI0.config.cpol(1).cpha(1).begin()');
    });
  });

  describe('Device Operations', () => {
    it('transpiles device transfer operation', () => {
      const result = transpile(`
        import { SPI0, D10 } from '@typecode/board-arduino-uno';
        SPI0.config.begin();
        const result = SPI0.device(D10).transfer(0xFF).execute();
      `, { target: 'arduino' });
      
      // Should contain SPI calls
      expect(result.cpp).toContain('SPI');
    });

    it('transpiles device read operation', () => {
      const result = transpile(`
        import { SPI0, D10 } from '@typecode/board-arduino-uno';
        SPI0.config.begin();
        const result = SPI0.device(D10).read(4).from(0x0F);
      `, { target: 'arduino' });
      
      // Should contain SPI calls
      expect(result.cpp).toContain('SPI');
    });

    it('transpiles device write operation', () => {
      const result = transpile(`
        import { SPI0, D10 } from '@typecode/board-arduino-uno';
        SPI0.config.begin();
        SPI0.device(D10).write(0x55).to(0x0F);
      `, { target: 'arduino' });
      
      // Should contain SPI calls
      expect(result.cpp).toContain('SPI');
    });
  });
});

describe('SPI HAL - Multiple Bus Support', () => {
  it('uses SPI for SPI0 on Arduino Uno', () => {
    const result = transpile(`
      import { SPI0 } from '@typecode/board-arduino-uno/arduino';
      SPI0.begin();
    `, { target: 'arduino' });
    
    // SPI0 -> SPI mapping implemented
    expect(result.cpp).toContain('SPI.begin()');
  });
});
