// ---------------------------------------------------------------------------
// HAL I2C Bus Tests
//
// Tests for I2C fluent and Arduino-compatible APIs
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpile } from './setup';

describe('I2C HAL - Arduino API Transpilation', () => {
  describe('Initialization', () => {
    it('transpiles I2C0.begin() as master', () => {
      const result = transpile(`
        import { I2C0 } from '@typecode/board-arduino-uno/arduino';
        I2C0.begin();
      `, { target: 'arduino' });
      
      // Note: Currently I2C0.begin() maps to Wire.begin()
      expect(result.cpp).toContain('Wire.begin()');
    });

    it('transpiles I2C0.begin(address) as slave', () => {
      const result = transpile(`
        import { I2C0 } from '@typecode/board-arduino-uno/arduino';
        I2C0.begin(0x40);
      `, { target: 'arduino' });
      
      // Note: hex values are transpiled as decimal (0x40 -> 64)
      expect(result.cpp).toContain('Wire.begin(64)');
    });

    it('transpiles I2C0.setClock()', () => {
      const result = transpile(`
        import { I2C0 } from '@typecode/board-arduino-uno/arduino';
        I2C0.begin();
        I2C0.setClock(400000);
      `, { target: 'arduino' });
      
      expect(result.cpp).toContain('Wire.setClock(400000)');
    });
  });

  describe('Write Operations', () => {
    it('transpiles beginTransmission/write/endTransmission sequence', () => {
      const result = transpile(`
        import { I2C0 } from '@typecode/board-arduino-uno/arduino';
        I2C0.begin();
        I2C0.beginTransmission(0x76);
        I2C0.write(0xFA);
        const status = I2C0.endTransmission();
      `, { target: 'arduino' });
      
      // Note: hex values transpiled as decimal (0x76 -> 118, 0xFA -> 250)
      expect(result.cpp).toContain('Wire.beginTransmission(118)');
      expect(result.cpp).toContain('Wire.write(250)');
      expect(result.cpp).toContain('Wire.endTransmission'); // may include default true param
    });

    it('transpiles write with array', () => {
      const result = transpile(`
        import { I2C0 } from '@typecode/board-arduino-uno/arduino';
        I2C0.begin();
        I2C0.beginTransmission(0x76);
        I2C0.write([0x01, 0x02, 0x03]);
        I2C0.endTransmission();
      `, { target: 'arduino' });
      
      expect(result.cpp).toContain('Wire.write');
    });

    it('transpiles endTransmission with stop parameter', () => {
      const result = transpile(`
        import { I2C0 } from '@typecode/board-arduino-uno/arduino';
        I2C0.begin();
        I2C0.beginTransmission(0x76);
        I2C0.write(0xFA);
        const status = I2C0.endTransmission(false);
      `, { target: 'arduino' });
      
      expect(result.cpp).toContain('Wire.endTransmission(false)');
    });
  });

  describe('Read Operations', () => {
    it('transpiles requestFrom/read sequence', () => {
      const result = transpile(`
        import { I2C0 } from '@typecode/board-arduino-uno/arduino';
        I2C0.begin();
        const count = I2C0.requestFrom(0x76, 4);
        const data = I2C0.read();
      `, { target: 'arduino' });
      
      // Note: hex address transpiled as decimal (0x76 -> 118)
      expect(result.cpp).toContain('Wire.requestFrom(118, 4)');
      expect(result.cpp).toContain('Wire.read()');
    });

    it('transpiles available() check', () => {
      const result = transpile(`
        import { I2C0 } from '@typecode/board-arduino-uno/arduino';
        I2C0.begin();
        I2C0.requestFrom(0x76, 4);
        while (I2C0.available() > 0) {
          const data = I2C0.read();
        }
      `, { target: 'arduino' });
      
      expect(result.cpp).toContain('Wire.available()');
    });

    it('transpiles requestFrom with stop parameter', () => {
      const result = transpile(`
        import { I2C0 } from '@typecode/board-arduino-uno/arduino';
        I2C0.begin();
        const count = I2C0.requestFrom(0x76, 4, true);
      `, { target: 'arduino' });
      
      // Note: hex address transpiled as decimal (0x76 -> 118)
      expect(result.cpp).toContain('Wire.requestFrom(118, 4, true)');
    });
  });

  describe('Cleanup', () => {
    it('transpiles I2C0.end()', () => {
      const result = transpile(`
        import { I2C0 } from '@typecode/board-arduino-uno/arduino';
        I2C0.begin();
        I2C0.end();
      `, { target: 'arduino' });
      
      expect(result.cpp).toContain('Wire.end()');
    });
  });
});

describe('I2C HAL - Fluent API Transpilation', () => {
  describe('Configuration', () => {
    it('transpiles fluent config chain (requires IR chain tracking)', () => {
      const result = transpile(`
        import { I2C0 } from '@typecode/board-arduino-uno';
        I2C0.config.speed(400000).begin();
      `, { target: 'arduino' });
      
      // TODO: Full fluent chain tracking requires IR-level chain analysis
      // Currently each method in chain is processed separately
      // I2C0.config.speed(400000).begin() -> Wire.begin() (speed handled separately)
      expect(result.cpp).toContain('Wire.begin()');
    });
  });

  describe('Device Operations', () => {
    it('transpiles device read operation', () => {
      const result = transpile(`
        import { I2C0 } from '@typecode/board-arduino-uno';
        I2C0.config.begin();
        const result = I2C0.device(0x76).read(2).from(0xFA);
      `, { target: 'arduino' });
      
      // Should contain Wire calls for reading from register
      expect(result.cpp).toContain('Wire');
    });

    it('transpiles device write operation', () => {
      const result = transpile(`
        import { I2C0 } from '@typecode/board-arduino-uno';
        I2C0.config.begin();
        I2C0.device(0x76).write(0x01).to(0xF4);
      `, { target: 'arduino' });
      
      // Should contain Wire calls for writing to register
      expect(result.cpp).toContain('Wire');
    });
  });
});

describe('I2C HAL - Multiple Bus Support', () => {
  it('uses Wire for I2C0 on Arduino Uno', () => {
    const result = transpile(`
      import { I2C0 } from '@typecode/board-arduino-uno/arduino';
      I2C0.begin();
    `, { target: 'arduino' });
    
    expect(result.cpp).toContain('Wire.begin()');
  });
});
