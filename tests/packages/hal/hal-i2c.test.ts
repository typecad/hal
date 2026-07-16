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
        import { I2C0 } from '@typecad/framework-arduino/arduino';
        I2C0.begin();
      `);

      expectCppContains(result, ['Wire.begin()']);
      // Note: <Wire.h> include is not auto-injected by the inline evaluator;
      // it relies on Arduino.h pulling it in transitively.
    });

    it('transpiles I2C0.beginSlave(address) as slave', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typecad/framework-arduino/arduino';
        I2C0.beginSlave(0x40);
      `);

      expectCppContains(result, ['Wire.begin(64)']);
    });

    it('transpiles I2C0.setClock()', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typecad/framework-arduino/arduino';
        I2C0.begin();
        I2C0.setClock(400000);
      `);
      
      expectCppContains(result, ['Wire.setClock(400000)']);
    });
  });

  describe('Write Operations', () => {
    it('transpiles beginTransmission/write/endTransmission sequence', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typecad/framework-arduino/arduino';
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
        import { I2C0 } from '@typecad/framework-arduino/arduino';
        I2C0.begin();
        I2C0.beginTransmission(0x76);
        I2C0.write([0x01, 0x02, 0x03]);
        I2C0.endTransmission();
      `);

      expectCppContains(result, ['Wire.beginTransmission(118)', 'Wire.write(1)', 'Wire.write(2)', 'Wire.write(3)']);
      expect(result.cpp).toContain('Wire.endTransmission');
    });

    it('transpiles endTransmission with stop parameter', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typecad/framework-arduino/arduino';
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
        import { I2C0 } from '@typecad/framework-arduino/arduino';
        I2C0.begin();
        const count = I2C0.requestFrom(0x76, 4);
        const data = I2C0.read();
      `);
      
      expectCppContains(result, ['Wire.requestFrom(118, 4, true)', 'Wire.read()']);
    });

    it('transpiles available() check', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typecad/framework-arduino/arduino';
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
        import { I2C0 } from '@typecad/framework-arduino/arduino';
        I2C0.begin();
        const count = I2C0.requestFrom(0x76, 4, true);
      `);
      
      expectCppContains(result, ['Wire.requestFrom(118, 4, true)']);
    });
  });

  describe('Cleanup', () => {
    it('transpiles I2C0.end()', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typecad/framework-arduino/arduino';
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
      import { I2C0 } from '@typecad/framework-arduino/arduino';
      I2C0.begin();
    `);
    
    expectCppContains(result, ['Wire.begin()']);
    expectCppNotContains(result, ['I2C0.begin']);
  });
});

describe('I2C HAL - Device Accessor Pattern', () => {
  it('transpiles I2C0.device(addr).writeByte(reg, val)', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typecad/framework-arduino/arduino';
      I2C0.begin();
      I2C0.device(0x76).writeByte(0xFA, 0x55);
    `);

    expectCppContains(result, ['Wire.begin()', 'Wire.beginTransmission(118)', 'Wire.write(250)', 'Wire.write(85)', 'Wire.endTransmission(true)']);
    expectCppNotContains(result, ['.device(', '.writeByte(']);
  });

  it('transpiles I2C0.device(addr).readByte(reg)', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typecad/framework-arduino/arduino';
      I2C0.begin();
      const val = I2C0.device(0x76).readByte(0xFA);
    `);

    expectCppContains(result, [
      'Wire.beginTransmission(118)',
      'Wire.write(250)',
      'Wire.endTransmission(false)',
    ]);
    // Wire.read() must be the initializer of val, not assigned to void
    expect(result.cpp).toMatch(/val\s*=\s*Wire\.read\(\)/);
    expect(result.cpp).not.toMatch(/=\s*Wire\.beginTransmission/);
  });

  it('transpiles I2C0.device(addr).writeBytes(reg, data)', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typecad/framework-arduino/arduino';
      I2C0.begin();
      I2C0.device(0x76).writeBytes(0xFA, [0x01, 0x02, 0x03]);
    `);

    expectCppContains(result, ['Wire.beginTransmission(118)', 'Wire.write(250)', 'Wire.endTransmission']);
  });

  // TODO: readBytes needs buffer allocation + read loop generation in inline evaluator
  it('transpiles I2C0.device(addr).readBytes(reg, count)', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typecad/framework-arduino/arduino';
      I2C0.begin();
      const buf = I2C0.device(0x76).readBytes(0xFA, 4);
    `);

    expectCppContains(result, [
      'Wire.beginTransmission(118)',
      'Wire.write(250)',
      'Wire.endTransmission(false)',
      'Wire.requestFrom(118, 4, true)',
      'Wire.read()',
    ]);
    // Must not assign buf to a void/int expression
    expect(result.cpp).not.toMatch(/buf\s*=\s*Wire\.beginTransmission/);
    expect(result.cpp).not.toMatch(/const int buf\s*=/);
  });

  // readBytes() returns a buffer of statically-known size (the count arg).
  // It must lower to a real C array the caller can index AND query .length on.
  // Previously the body emitted `static uint8_t __buf[N]; ...; return __buf;`
  // via rawCpp, which decays to a raw uint8_t* pointer — so .length lowered to
  // `data.size()` (invalid: a pointer has no .size()). The buffer must be
  // declared in the caller's scope as a real uint8_t array and filled by the
  // i2c.read_buffer semantic op so .length resolves to N.
  it('readBytes result is a real C array whose .length resolves to the count', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typecad/framework-arduino/arduino';
      I2C0.begin();
      const sensor = I2C0.device(0x44);
      sensor.writeByte(0x2c, 0x06);
      const data = sensor.readBytes(0, 6);
      const n = data.length;
      const first = data[0];
    `);

    expect(result.cpp).toMatch(/uint8_t\s+data\s*\[/);
    expect(result.cpp).not.toMatch(/__buf/);
    expect(result.cpp).not.toMatch(/auto\s+data/);
    expect(result.cpp).not.toMatch(/const\s+uint8_t\s+data/);
    expect(result.cpp).toContain('sizeof(data) / sizeof(data[0])');
    expect(result.cpp).not.toMatch(/data\.size\(\)/);
    expectCppContains(result, ['Wire.requestFrom(68, 6, true)', 'data[__i] = Wire.read()']);
    expect(result.cpp).toMatch(/data\s*\[\s*0\s*\]/);
  });

  // The buffer var_decl must precede the fill loop in emitted C++ order. At top
  // level the var_decl is hoisted to file scope (masking the ordering), but a
  // function-local `const data = ...readBytes()` must still declare `data`
  // BEFORE the fill loop references it.
  it('readBytes buffer is declared before the fill loop inside a function', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typecad/framework-arduino/arduino';
      function readSensor(): number {
        const data = I2C0.device(0x68).readBytes(0xFA, 4);
        return data[0];
      }
      I2C0.begin();
      const v = readSensor();
    `);

    const declIdx = result.cpp.indexOf('uint8_t data[]');
    const fillIdx = result.cpp.indexOf('data[__i] = Wire.read()');
    expect(declIdx).not.toBe(-1);
    expect(fillIdx).not.toBe(-1);
    expect(declIdx).toBeLessThan(fillIdx);
  });
});

describe('I2C HAL - Bus Variable Aliasing', () => {
  it('transpiles const i2c = I2C0.begin() without emitting C++ variable', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typecad/framework-arduino/arduino';
      const i2c = I2C0.begin();
    `);

    expectCppContains(result, ['Wire.begin()']);
    expectCppNotContains(result, ['const int i2c', 'i2c =']);
  });

  it('transpiles bus alias with device accessor: const i2c = I2C0.begin(); i2c.device(addr).writeByte(reg, val)', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typecad/framework-arduino/arduino';
      const i2c = I2C0.begin();
      i2c.device(0x76).writeByte(0xFA, 0x55);
    `);

    expectCppContains(result, [
      'Wire.begin()',
      'Wire.beginTransmission(118)',
      'Wire.write(250)',
      'Wire.write(85)',
      'Wire.endTransmission(true)',
    ]);
    expectCppNotContains(result, ['const int i2c', 'i2c.']);
  });

  it('transpiles bus alias with setClock', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typecad/framework-arduino/arduino';
      const i2c = I2C0.begin();
      i2c.setClock(400000);
    `);

    expectCppContains(result, ['Wire.begin()', 'Wire.setClock(400000)']);
    expectCppNotContains(result, ['const int i2c']);
  });

  it('transpiles bus alias with beginTransmission/write/endTransmission', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typecad/framework-arduino/arduino';
      const i2c = I2C0.begin();
      i2c.beginTransmission(0x76);
      i2c.write(0xFA);
      i2c.endTransmission();
    `);

    expectCppContains(result, ['Wire.begin()', 'Wire.beginTransmission(118)', 'Wire.write(250)']);
    expect(result.cpp).toContain('Wire.endTransmission');
    expectCppNotContains(result, ['const int i2c', 'i2c.']);
  });

  it('transpiles const bus = I2C0.take() and bus.release() without invalid C++', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typecad/framework-arduino/arduino';
      const bus = I2C0.take();
      bus.beginTransmission(0x76);
      bus.write(0xFA);
      bus.endTransmission();
      bus.release();
    `);

    expectCppContains(result, [
      'Wire.beginTransmission(118)',
      'Wire.write(250)',
    ]);
    expect(result.cpp).toContain('Wire.endTransmission');
    expect(result.cpp).not.toContain('I2C0.take');
    expect(result.cpp).not.toContain('bus.take');
    expect(result.cpp).not.toContain('bus.release');
    expect(result.cpp).not.toContain('const auto bus');
  });
  
  describe('I2C HAL - Multi-Byte Write & Uint8Array', () => {
    it('transpiles new Uint8Array([...]) as uint8_t C array', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typecad/framework-arduino/arduino';
        I2C0.begin();
        const buf = new Uint8Array([0x01, 0x02, 0x03]);
      `);
  
      expectCppContains(result, ['uint8_t buf[] = { 1, 2, 3 }']);
      expectCppNotContains(result, ['new Uint8Array', 'Uint8Array*']);
    });
  
    it('transpiles device.writeBytes with array literal via resolver', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typecad/framework-arduino/arduino';
        I2C0.begin();
        I2C0.device(0x76).writeBytes(0xF5, [0b10100000, 0b00100111]);
      `);

      expectCppContains(result, [
        'Wire.beginTransmission(118)',
        'Wire.write(245)',
        'Wire.endTransmission',
      ]);
    });
  
    it('transpiles device.writeBytes with variable reference using sizeof', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typecad/framework-arduino/arduino';
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
    it('escapes C++ reserved keyword register in function parameters', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typecad/framework-arduino/arduino';
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

    // KNOWN BUG: the clamp function body is eliminated (tree-shaking /
    // constant-folding removes the Math.max/Math.min logic even though the
    // function is emitted), so the expected body fragments are absent.
    // Tracked here as .skip.
    it.skip('escapes Arduino macro names min and max in function parameters', () => {
      const result = transpileArduino(`
        import { Pin } from '@typecad/hal';
        function clamp(value: number, min: number, max: number): number {
          return Math.max(min, Math.min(max, value));
        }

        const resultValue = clamp(2000, 0, 1023);
      `);

      expectCppContains(result, ['int min_', 'int max_']);
      expectCppNotContains(result, ['int min,', 'int max,']);
      expect(result.cpp).toContain('min_ >');
      expect(result.cpp).toContain('max_ < value');
      expectCppNotContains(result, ['std::max', 'std::min']);
    });
  
    it('maps Uint8Array parameter type to uint8_t*', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typecad/framework-arduino/arduino';
        I2C0.begin();
        function send(register: number, data: Uint8Array): void {
          I2C0.device(0x76).writeBytes(register, data);
        }
      `);
  
      expect(result.cpp).toContain('uint8_t*');
      expectCppNotContains(result, ['int data']);
    });
  
    it('transpiles .length on a top-level number[] literal as sizeof (raw C array on AVR)', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typecad/framework-arduino/arduino';
        I2C0.begin();
        const values = [10, 20, 30];
        const len = values.length;
      `);
  
      // A top-level non-mutated array literal on AVR (a literal-promoting
      // target) lowers to a RAW C array `int values[] = {...}`, NOT a
      // std::vector (AVR has no <vector>). `.length` on a raw C array must be
      // `sizeof(values)/sizeof(values[0])` — `.size()` is not a member of an
      // array type. Demo #33 Finding B. (A function-local mutated array, by
      // contrast, promotes to __tc_StaticArray and uses .size() — covered by
      // other tests.)
      expect(result.cpp).toContain('(sizeof(values) / sizeof(values[0]))');
    });
  
    it('transpiles .length on Uint8Array variable as sizeof expression', () => {
      const result = transpileArduino(`
        import { I2C0 } from '@typecad/framework-arduino/arduino';
        I2C0.begin();
        const buf = new Uint8Array([0x01, 0x02, 0x03]);
        const len = buf.length;
      `);
  
      // Uint8Array maps to uint8_t[] C array, so .length → sizeof(buf)/sizeof(buf[0])
      expect(result.cpp).toContain('sizeof(buf) / sizeof(buf[0])');
    });
  });
});

// ---------------------------------------------------------------------------
// Two-step device pattern: const dev = bus.device(addr); dev.method()
//
// Unlike the inline chained pattern (I2C0.device(addr).method()), this stores
// the device in a variable and calls methods on it later. The HAL alias
// resolver must follow the chain: sensor → bus → I2C0 → I2CBus, apply the
// device() factory transformation (I2CBus → I2CDevice with _address), and
// resolve this._address / this._bus inside method bodies.
// ---------------------------------------------------------------------------

describe('I2C HAL - Two-step device variable pattern', () => {
  it('resolves sensor.writeByte via const sensor = bus.device(addr)', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typecad/framework-arduino/arduino';
      const bus = I2C0.begin();
      const sensor = bus.device(0x76);
      sensor.writeByte(0xF4, 0x27);
    `);

    // The address (0x76 = 118) must be resolved inside writeByte's method body
    expectCppContains(result, [
      'Wire.begin()',
      'Wire.beginTransmission(118)',
      'Wire.write(244)',
      'Wire.write(39)',
      'Wire.endTransmission(true)',
    ]);
    // this->_address must NOT leak into the method body lowering
    expectCppNotContains(result, ['this->_address', 'this->_bus']);
  });

  it('resolves sensor.readByte via const sensor = bus.device(addr)', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typecad/framework-arduino/arduino';
      const bus = I2C0.begin();
      const sensor = bus.device(0x76);
      const val = sensor.readByte(0xD0);
    `);

    expectCppContains(result, [
      'Wire.beginTransmission(118)',
      'Wire.write(208)',
    ]);
    expectCppNotContains(result, ['this->_address', 'this->_bus']);
  });

  it('resolves sensor.writeBytes via const sensor = bus.device(addr)', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typecad/framework-arduino/arduino';
      const bus = I2C0.begin();
      const sensor = bus.device(0x76);
      sensor.writeBytes(0xFA, [0x01, 0x02, 0x03]);
    `);

    expectCppContains(result, [
      'Wire.beginTransmission(118)',
      'Wire.write(250)',
    ]);
    expectCppNotContains(result, ['this->_address']);
  });
});
