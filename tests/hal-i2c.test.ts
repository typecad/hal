// ---------------------------------------------------------------------------
// HAL I2C Bus Tests
//
// Tests for I2C Arduino-compatible API
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { expectCppContains, expectCppNotContains, hasInclude, transpileArduino } from './setup';

describe('I2C HAL - Arduino API Transpilation', () => {
  describe('Initialization', () => {
    it('transpiles I2C0.begin() as master', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typecode/board-arduino-uno/arduino';
        I2C0.begin();
      `);
      
      expectCppContains(result, ['Wire.begin()']);
      expect(hasInclude(result.cpp, '<Wire.h>')).toBe(true);
    });

    it('transpiles I2C0.begin(address) as slave', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typecode/board-arduino-uno/arduino';
        I2C0.begin(0x40);
      `);
      
      expectCppContains(result, ['Wire.begin(64)']);
    });

    it('transpiles I2C0.setClock()', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typecode/board-arduino-uno/arduino';
        I2C0.begin();
        I2C0.setClock(400000);
      `);
      
      expectCppContains(result, ['Wire.setClock(400000)']);
    });
  });

  describe('Write Operations', () => {
    it('transpiles beginTransmission/write/endTransmission sequence', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typecode/board-arduino-uno/arduino';
        I2C0.begin();
        I2C0.beginTransmission(0x76);
        I2C0.write(0xFA);
        const status = I2C0.endTransmission();
      `);
      
      expectCppContains(result, ['Wire.beginTransmission(118)', 'Wire.write(250)']);
      expect(result.cpp).toContain('Wire.endTransmission'); // may include default true param
    });

    it('transpiles write with array', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typecode/board-arduino-uno/arduino';
        I2C0.begin();
        I2C0.beginTransmission(0x76);
        I2C0.write([0x01, 0x02, 0x03]);
        I2C0.endTransmission();
      `);
      
      expectCppContains(result, ['Wire.write']);
    });

    it('transpiles endTransmission with stop parameter', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typecode/board-arduino-uno/arduino';
        I2C0.begin();
        I2C0.beginTransmission(0x76);
        I2C0.write(0xFA);
        const status = I2C0.endTransmission(false);
      `);
      
      expectCppContains(result, ['Wire.endTransmission(false)']);
    });
  });

  describe('Read Operations', () => {
    it('transpiles requestFrom/read sequence', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typecode/board-arduino-uno/arduino';
        I2C0.begin();
        const count = I2C0.requestFrom(0x76, 4);
        const data = I2C0.read();
      `);
      
      expectCppContains(result, ['Wire.requestFrom(118, 4)', 'Wire.read()']);
    });

    it('transpiles available() check', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typecode/board-arduino-uno/arduino';
        I2C0.begin();
        I2C0.requestFrom(0x76, 4);
        while (I2C0.available() > 0) {
          const data = I2C0.read();
        }
      `);
      
      expectCppContains(result, ['Wire.available()']);
    });

    it('transpiles requestFrom with stop parameter', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typecode/board-arduino-uno/arduino';
        I2C0.begin();
        const count = I2C0.requestFrom(0x76, 4, true);
      `);
      
      expectCppContains(result, ['Wire.requestFrom(118, 4, true)']);
    });
  });

  describe('Cleanup', () => {
    it('transpiles I2C0.end()', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typecode/board-arduino-uno/arduino';
        I2C0.begin();
        I2C0.end();
      `);
      
      expectCppContains(result, ['Wire.end()']);
    });
  });
});

describe('I2C HAL - Multiple Bus Support', () => {
  it('uses Wire for I2C0 on Arduino Uno', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typecode/board-arduino-uno/arduino';
      I2C0.begin();
    `);
    
    expectCppContains(result, ['Wire.begin()']);
  });
});

describe('I2C HAL - Device Accessor Pattern', () => {
  it('transpiles I2C0.device(addr).writeByte(reg, val)', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typecode/board-arduino-uno/arduino';
      I2C0.begin();
      I2C0.device(0x76).writeByte(0xFA, 0x55);
    `);

    expectCppContains(result, ['Wire.begin()', 'Wire.beginTransmission(118)', 'Wire.write(250)', 'Wire.write(85)', 'Wire.endTransmission()']);
    expectCppNotContains(result, ['.device(', '.writeByte(']);
  });

  it('transpiles I2C0.device(addr).readByte(reg)', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typecode/board-arduino-uno/arduino';
      I2C0.begin();
      const val = I2C0.device(0x76).readByte(0xFA);
    `);

    expectCppContains(result, [
      'Wire.beginTransmission(118)',
      'Wire.write(250)',
      'Wire.endTransmission(false)',
      'Wire.requestFrom(118, 1)',
    ]);
    // Wire.read() must be the initializer of val, not assigned to void
    expect(result.cpp).toMatch(/val\s*=\s*Wire\.read\(\)/);
    expect(result.cpp).not.toMatch(/=\s*Wire\.beginTransmission/);
  });

  it('transpiles I2C0.device(addr).writeBytes(reg, data)', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typecode/board-arduino-uno/arduino';
      I2C0.begin();
      I2C0.device(0x76).writeBytes(0xFA, [0x01, 0x02, 0x03]);
    `);

    expectCppContains(result, ['Wire.beginTransmission(118)', 'Wire.write(250)', 'Wire.endTransmission()']);
  });

  it('transpiles I2C0.device(addr).readBytes(reg, count)', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typecode/board-arduino-uno/arduino';
      I2C0.begin();
      const buf = I2C0.device(0x76).readBytes(0xFA, 4);
    `);

    expectCppContains(result, [
      'uint8_t buf[4]',
      'Wire.beginTransmission(118)',
      'Wire.write(250)',
      'Wire.endTransmission(false)',
      'Wire.requestFrom(118, 4)',
      'Wire.read()',
    ]);
    // Must not assign buf to a void/int expression
    expect(result.cpp).not.toMatch(/buf\s*=\s*Wire\.beginTransmission/);
    expect(result.cpp).not.toMatch(/const int buf\s*=/);
  });
});

describe('I2C HAL - Bus Variable Aliasing', () => {
  it('transpiles const i2c = I2C0.begin() without emitting C++ variable', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typecode/board-arduino-uno/arduino';
      const i2c = I2C0.begin();
    `);

    expectCppContains(result, ['Wire.begin()']);
    expectCppNotContains(result, ['const int i2c', 'i2c =']);
  });

  it('transpiles bus alias with device accessor: const i2c = I2C0.begin(); i2c.device(addr).writeByte(reg, val)', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typecode/board-arduino-uno/arduino';
      const i2c = I2C0.begin();
      i2c.device(0x76).writeByte(0xFA, 0x55);
    `);

    expectCppContains(result, [
      'Wire.begin()',
      'Wire.beginTransmission(118)',
      'Wire.write(250)',
      'Wire.write(85)',
      'Wire.endTransmission()',
    ]);
    expectCppNotContains(result, ['const int i2c', 'i2c.']);
  });

  it('transpiles bus alias with setClock', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typecode/board-arduino-uno/arduino';
      const i2c = I2C0.begin();
      i2c.setClock(400000);
    `);

    expectCppContains(result, ['Wire.begin()', 'Wire.setClock(400000)']);
    expectCppNotContains(result, ['const int i2c']);
  });

  it('transpiles bus alias with beginTransmission/write/endTransmission', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typecode/board-arduino-uno/arduino';
      const i2c = I2C0.begin();
      i2c.beginTransmission(0x76);
      i2c.write(0xFA);
      i2c.endTransmission();
    `);

    expectCppContains(result, ['Wire.begin()', 'Wire.beginTransmission(118)', 'Wire.write(250)']);
    expect(result.cpp).toContain('Wire.endTransmission');
    expectCppNotContains(result, ['const int i2c', 'i2c.']);
  });
});
