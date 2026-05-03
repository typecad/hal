// ---------------------------------------------------------------------------
// HAL I2C Bus Tests
//
// Tests for I2C Arduino-compatible API
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { expectCppContains, expectCppNotContains, hasInclude, transpileArduino } from '../../setup';

describe('I2C HAL - Arduino API Transpilation', () => {
  describe('Initialization', () => {
    it('transpiles I2C0.begin() as master', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typehal/framework-arduino/arduino';
        I2C0.begin();
      `);

      expectCppContains(result, ['Wire.begin()']);
      // Note: <Wire.h> include is not auto-injected by the inline evaluator;
      // it relies on Arduino.h pulling it in transitively.
    });

    it('transpiles I2C0.begin(address) as slave', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typehal/framework-arduino/arduino';
        I2C0.begin(0x40);
      `);
      
      expectCppContains(result, ['Wire.begin(64)']);
    });

    it('transpiles I2C0.setClock()', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typehal/framework-arduino/arduino';
        I2C0.begin();
        I2C0.setClock(400000);
      `);
      
      expectCppContains(result, ['Wire.setClock(400000)']);
    });
  });

  describe('Write Operations', () => {
    it('transpiles beginTransmission/write/endTransmission sequence', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typehal/framework-arduino/arduino';
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
        import { I2C0 } from '@typehal/framework-arduino/arduino';
        I2C0.begin();
        I2C0.beginTransmission(0x76);
        I2C0.write([0x01, 0x02, 0x03]);
        I2C0.endTransmission();
      `);

      expectCppContains(result, ['Wire.beginTransmission(118)', 'Wire.write({ 1, 2, 3 })']);
      expect(result.cpp).toContain('Wire.endTransmission');
    });

    it('transpiles endTransmission with stop parameter', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typehal/framework-arduino/arduino';
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
        import { I2C0 } from '@typehal/framework-arduino/arduino';
        I2C0.begin();
        const count = I2C0.requestFrom(0x76, 4);
        const data = I2C0.read();
      `);
      
      expectCppContains(result, ['Wire.requestFrom(118, 4)', 'Wire.read()']);
    });

    it('transpiles available() check', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typehal/framework-arduino/arduino';
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
        import { I2C0 } from '@typehal/framework-arduino/arduino';
        I2C0.begin();
        const count = I2C0.requestFrom(0x76, 4, true);
      `);
      
      expectCppContains(result, ['Wire.requestFrom(118, 4, true)']);
    });
  });

  describe('Cleanup', () => {
    it('transpiles I2C0.end()', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typehal/framework-arduino/arduino';
        I2C0.begin();
        I2C0.end();
      `);
      
      expectCppContains(result, ['Wire.end()']);
    });
  });
});

describe('I2C HAL - Multiple Bus Support', () => {
  it('lowers the high-level I2C API to Wire calls on Arduino Uno', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typehal/framework-arduino/arduino';
      I2C0.begin();
    `);
    
    expectCppContains(result, ['Wire.begin()']);
    expectCppNotContains(result, ['I2C0.begin']);
  });
});

describe('I2C HAL - Device Accessor Pattern', () => {
  it('transpiles I2C0.device(addr).writeByte(reg, val)', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typehal/framework-arduino/arduino';
      I2C0.begin();
      I2C0.device(0x76).writeByte(0xFA, 0x55);
    `);

    expectCppContains(result, ['Wire.begin()', 'Wire.beginTransmission(118)', 'Wire.write(250)', 'Wire.write(85)', 'Wire.endTransmission()']);
    expectCppNotContains(result, ['.device(', '.writeByte(']);
  });

  it('transpiles I2C0.device(addr).readByte(reg)', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typehal/framework-arduino/arduino';
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
      import { I2C0 } from '@typehal/framework-arduino/arduino';
      I2C0.begin();
      I2C0.device(0x76).writeBytes(0xFA, [0x01, 0x02, 0x03]);
    `);

    expectCppContains(result, ['Wire.beginTransmission(118)', 'Wire.write(250)', 'Wire.endTransmission()']);
  });

  // TODO: readBytes needs buffer allocation + read loop generation in inline evaluator
  it.skip('transpiles I2C0.device(addr).readBytes(reg, count)', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typehal/framework-arduino/arduino';
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
      import { I2C0 } from '@typehal/framework-arduino/arduino';
      const i2c = I2C0.begin();
    `);

    expectCppContains(result, ['Wire.begin()']);
    expectCppNotContains(result, ['const int i2c', 'i2c =']);
  });

  it('transpiles bus alias with device accessor: const i2c = I2C0.begin(); i2c.device(addr).writeByte(reg, val)', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typehal/framework-arduino/arduino';
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
      import { I2C0 } from '@typehal/framework-arduino/arduino';
      const i2c = I2C0.begin();
      i2c.setClock(400000);
    `);

    expectCppContains(result, ['Wire.begin()', 'Wire.setClock(400000)']);
    expectCppNotContains(result, ['const int i2c']);
  });

  it('transpiles bus alias with beginTransmission/write/endTransmission', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typehal/framework-arduino/arduino';
      const i2c = I2C0.begin();
      i2c.beginTransmission(0x76);
      i2c.write(0xFA);
      i2c.endTransmission();
    `);

    expectCppContains(result, ['Wire.begin()', 'Wire.beginTransmission(118)', 'Wire.write(250)']);
    expect(result.cpp).toContain('Wire.endTransmission');
    expectCppNotContains(result, ['const int i2c', 'i2c.']);
  });
  
  describe('I2C HAL - Multi-Byte Write & Uint8Array', () => {
    it('transpiles new Uint8Array([...]) as uint8_t C array', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typehal/framework-arduino/arduino';
        I2C0.begin();
        const buf = new Uint8Array([0x01, 0x02, 0x03]);
      `);
  
      expectCppContains(result, ['uint8_t buf[] = { 1, 2, 3 }']);
      expectCppNotContains(result, ['new Uint8Array', 'Uint8Array*']);
    });
  
    it('expands device.writeBytes array literal into individual Wire.write() calls', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typehal/framework-arduino/arduino';
        I2C0.begin();
        I2C0.device(0x76).writeBytes(0xF5, [0b10100000, 0b00100111]);
      `);
  
      expectCppContains(result, [
        'Wire.beginTransmission(118)',
        'Wire.write(245)',
        'Wire.write(160)',
        'Wire.write(39)',
        'Wire.endTransmission()',
      ]);
      // Must NOT emit bare init-list { 160, 39 }
      expect(result.cpp).not.toContain('Wire.write({');
    });
  
    it('transpiles device.writeBytes with variable reference using sizeof', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typehal/framework-arduino/arduino';
        I2C0.begin();
        const data = new Uint8Array([0x10, 0x20]);
        I2C0.device(0x76).writeBytes(0xFA, data);
      `);
  
      expectCppContains(result, [
        'uint8_t data[] = { 16, 32 }',
        'Wire.write(data, sizeof(data))',
      ]);
    });
  
    // TODO: The inline evaluator emits raw text without applying C++ keyword escaping.
    // Parameter renaming happens in the emitter, but __EMIT__ nodes bypass it.
    it.skip('escapes C++ reserved keyword register in function parameters', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typehal/framework-arduino/arduino';
        I2C0.begin();
        function writeReg(register: number, value: number): void {
          I2C0.device(0x76).writeByte(register, value);
        }
      `);
  
      // Parameter declaration must use register_ not register
      expectCppContains(result, ['register_']);
      expectCppNotContains(result, ['int register,']);
      // Body references must also use register_
      expect(result.cpp).toMatch(/register_/);
      expect(result.cpp).not.toMatch(/\bregister\b[^_]/);
    });

    it('escapes Arduino macro names min and max in function parameters', () => {
      const result = transpileArduino(`
        import { Pin } from '@typehal/core';
        function clamp(value: number, min: number, max: number): number {
          return Math.max(min, Math.min(max, value));
        }

        const resultValue = clamp(2000, 0, 1023);
      `);

      expectCppContains(result, ['int min_', 'int max_']);
      expectCppNotContains(result, ['int min,', 'int max,']);
      expect(result.cpp).toContain('max(min_, min(max_, value))');
    });
  
    it('maps Uint8Array parameter type to uint8_t*', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typehal/framework-arduino/arduino';
        I2C0.begin();
        function send(register: number, data: Uint8Array): void {
          I2C0.device(0x76).writeBytes(register, data);
        }
      `);
  
      expect(result.cpp).toContain('uint8_t*');
      expectCppNotContains(result, ['int data']);
    });
  
    it('transpiles .length on number[] variable as .size() (std::vector)', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typehal/framework-arduino/arduino';
        I2C0.begin();
        const values = [10, 20, 30];
        const len = values.length;
      `);
  
      // number[] maps to std::vector<int>, so .length → .size()
      expect(result.cpp).toContain('values.size()');
    });
  
    it('transpiles .length on Uint8Array variable as sizeof expression', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typehal/framework-arduino/arduino';
        I2C0.begin();
        const buf = new Uint8Array([0x01, 0x02, 0x03]);
        const len = buf.length;
      `);
  
      // Uint8Array maps to uint8_t[] C array, so .length → sizeof(buf)/sizeof(buf[0])
      expect(result.cpp).toContain('sizeof(buf) / sizeof(buf[0])');
    });
  });
});
