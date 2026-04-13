// ---------------------------------------------------------------------------
// HAL I2C Bus Tests
//
// Tests for I2C Arduino-compatible API
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

describe('I2C HAL - Multiple Bus Support', () => {
  it('uses Wire for I2C0 on Arduino Uno', () => {
    const result = transpile(`
      import { I2C0 } from '@typecode/board-arduino-uno/arduino';
      I2C0.begin();
    `, { target: 'arduino' });
    
    expect(result.cpp).toContain('Wire.begin()');
  });
});

describe('I2C HAL - Device Accessor Pattern', () => {
  it('transpiles I2C0.device(addr).writeByte(reg, val)', () => {
    const result = transpile(`
      import { I2C0 } from '@typecode/board-arduino-uno/arduino';
      I2C0.begin();
      I2C0.device(0x76).writeByte(0xFA, 0x55);
    `, { target: 'arduino' });

    expect(result.cpp).toContain('Wire.begin()');
    expect(result.cpp).toContain('Wire.beginTransmission(118)');
    expect(result.cpp).toContain('Wire.write(250)');
    expect(result.cpp).toContain('Wire.write(85)');
    expect(result.cpp).toContain('Wire.endTransmission()');
    expect(result.cpp).not.toContain('.device(');
    expect(result.cpp).not.toContain('.writeByte(');
  });

  it('transpiles I2C0.device(addr).readByte(reg)', () => {
    const result = transpile(`
      import { I2C0 } from '@typecode/board-arduino-uno/arduino';
      I2C0.begin();
      const val = I2C0.device(0x76).readByte(0xFA);
    `, { target: 'arduino' });

    expect(result.cpp).toContain('Wire.beginTransmission(118)');
    expect(result.cpp).toContain('Wire.write(250)');
    expect(result.cpp).toContain('Wire.endTransmission(false)');
    expect(result.cpp).toContain('Wire.requestFrom(118, 1)');
    expect(result.cpp).toContain('Wire.read()');
  });

  it('transpiles I2C0.device(addr).writeBytes(reg, data)', () => {
    const result = transpile(`
      import { I2C0 } from '@typecode/board-arduino-uno/arduino';
      I2C0.begin();
      I2C0.device(0x76).writeBytes(0xFA, [0x01, 0x02, 0x03]);
    `, { target: 'arduino' });

    expect(result.cpp).toContain('Wire.beginTransmission(118)');
    expect(result.cpp).toContain('Wire.write(250)');
    expect(result.cpp).toContain('Wire.endTransmission()');
  });

  it('transpiles I2C0.device(addr).readBytes(reg, count)', () => {
    const result = transpile(`
      import { I2C0 } from '@typecode/board-arduino-uno/arduino';
      I2C0.begin();
      const buf = I2C0.device(0x76).readBytes(0xFA, 4);
    `, { target: 'arduino' });

    expect(result.cpp).toContain('Wire.beginTransmission(118)');
    expect(result.cpp).toContain('Wire.write(250)');
    expect(result.cpp).toContain('Wire.endTransmission(false)');
    expect(result.cpp).toContain('Wire.requestFrom(118, 4)');
  });
});

describe('I2C HAL - Bus Variable Aliasing', () => {
  it('transpiles const i2c = I2C0.begin() without emitting C++ variable', () => {
    const result = transpile(`
      import { I2C0 } from '@typecode/board-arduino-uno/arduino';
      const i2c = I2C0.begin();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('Wire.begin()');
    expect(result.cpp).not.toContain('const int i2c');
    expect(result.cpp).not.toContain('i2c =');
  });

  it('transpiles bus alias with device accessor: const i2c = I2C0.begin(); i2c.device(addr).writeByte(reg, val)', () => {
    const result = transpile(`
      import { I2C0 } from '@typecode/board-arduino-uno/arduino';
      const i2c = I2C0.begin();
      i2c.device(0x76).writeByte(0xFA, 0x55);
    `, { target: 'arduino' });

    expect(result.cpp).toContain('Wire.begin()');
    expect(result.cpp).not.toContain('const int i2c');
    expect(result.cpp).toContain('Wire.beginTransmission(118)');
    expect(result.cpp).toContain('Wire.write(250)');
    expect(result.cpp).toContain('Wire.write(85)');
    expect(result.cpp).toContain('Wire.endTransmission()');
    expect(result.cpp).not.toContain('i2c.');
  });

  it('transpiles bus alias with setClock', () => {
    const result = transpile(`
      import { I2C0 } from '@typecode/board-arduino-uno/arduino';
      const i2c = I2C0.begin();
      i2c.setClock(400000);
    `, { target: 'arduino' });

    expect(result.cpp).toContain('Wire.begin()');
    expect(result.cpp).toContain('Wire.setClock(400000)');
    expect(result.cpp).not.toContain('const int i2c');
  });

  it('transpiles bus alias with beginTransmission/write/endTransmission', () => {
    const result = transpile(`
      import { I2C0 } from '@typecode/board-arduino-uno/arduino';
      const i2c = I2C0.begin();
      i2c.beginTransmission(0x76);
      i2c.write(0xFA);
      i2c.endTransmission();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('Wire.begin()');
    expect(result.cpp).toContain('Wire.beginTransmission(118)');
    expect(result.cpp).toContain('Wire.write(250)');
    expect(result.cpp).toContain('Wire.endTransmission');
    expect(result.cpp).not.toContain('const int i2c');
    expect(result.cpp).not.toContain('i2c.');
  });
});
