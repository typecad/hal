// ---------------------------------------------------------------------------
// `.length` on a call-result receiver (e.g. `build().length`, `obj.method().length`)
//
// resolveLengthProperty (expression-to-ir.ts) routes `.length` by the receiver.
// For a CALL-EXPRESSION receiver it previously emitted an unconditional
// `<call>.size()`, which is wrong when the call returns a raw pointer/array
// (no `.size()` member) and only happened to work for std::string/std::vector
// returns. These tests pin the return-type-aware routing:
//   - string return       → `.length()`
//   - vector/container    → `.size()`
//   - raw pointer return  → diagnostic (un-sizeable at the call site)
//   - HAL buffer inline   → diagnostic (the call lowers to statements, not an
//                            expression; capture into a variable first)
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpileNative, transpileArduino } from '../../setup';

const errorDiags = (r: { diagnostics: { severity: string; code?: string }[] }) =>
  r.diagnostics.filter(d => d.severity === 'error');

describe('.length on a call-result receiver routes by return type', () => {
  it('string return → .length() (not .size())', () => {
    const result = transpileNative(`
      function greet(): string { return "hello"; }
      const n = greet().length;
    `);
    expect(errorDiags(result)).toEqual([]);
    expect(result.cpp).toMatch(/greet\(\)\.length\(\)/);
    expect(result.cpp).not.toMatch(/greet\(\)\.size\(\)/);
  });

  it('class method returning string → .length()', () => {
    const result = transpileNative(`
      class Dog {
        name: string;
        constructor(n: string) { this.name = n; }
        identify(): string { return this.name; }
      }
      const d = new Dog("Rex");
      const n = d.identify().length;
    `);
    expect(errorDiags(result)).toEqual([]);
    expect(result.cpp).toMatch(/identify\(\)\.length\(\)/);
  });

  it('number[] return (std::vector on native) → .size()', () => {
    const result = transpileNative(`
      function build(): number[] {
        const row: number[] = [];
        row.push(1);
        return row;
      }
      const n = build().length;
    `);
    expect(errorDiags(result)).toEqual([]);
    expect(result.cpp).toMatch(/build\(\)\.size\(\)/);
  });
});

describe('.length on an un-sizeable call-result surfaces a diagnostic', () => {
  it('Uint8Array function return (lowers to a raw pointer) → TC_LENGTH_ON_POINTER_RETURN', () => {
    // A function returning Uint8Array lowers to `uint8_t*`; sizeof would yield
    // sizeof(pointer), not the buffer length. There is no size at the call site,
    // so emit a diagnostic rather than silently wrong code.
    const result = transpileNative(`
      function build(): Uint8Array {
        const row = new Uint8Array([1, 2, 3]);
        return row;
      }
      const n = build().length;
    `);
    const codes = errorDiags(result).map(d => d.code);
    expect(codes).toContain('TC_LENGTH_ON_POINTER_RETURN');
  });

  it('inline HAL readBytes().length → TC_BUFFER_INLINE_LENGTH (capture into a var first)', () => {
    // readBytes() lowers to STATEMENTS (a fill loop) and returns a buffer with
    // no caller-side name; it cannot be used as a sub-expression. The supported
    // form is `const data = dev.readBytes(...); data.length`.
    const result = transpileArduino(`
      import { I2C0 } from '@typecad/framework-arduino/arduino';
      I2C0.begin();
      const n = I2C0.device(0x44).readBytes(0, 6).length;
    `);
    const codes = errorDiags(result).map(d => d.code);
    expect(codes).toContain('TC_BUFFER_INLINE_LENGTH');
    // Must not emit the broken `for(...) ... .size()` splice.
    expect(result.cpp).not.toMatch(/for\s*\([^)]*\)\s*[^;]*\.size\(\)/);
  });

  it('named-instance inline readBytes().length → TC_BUFFER_INLINE_LENGTH too', () => {
    const result = transpileArduino(`
      import { I2C0 } from '@typecad/framework-arduino/arduino';
      I2C0.begin();
      const sensor = I2C0.device(0x44);
      const n = sensor.readBytes(0, 6).length;
    `);
    const codes = errorDiags(result).map(d => d.code);
    expect(codes).toContain('TC_BUFFER_INLINE_LENGTH');
  });

  it('the supported two-step form still works (no diagnostic, correct sizeof)', () => {
    // Regression guard: capturing the buffer into a variable must remain the
    // supported path — `.length` resolves to sizeof, no diagnostic.
    const result = transpileArduino(`
      import { I2C0 } from '@typecad/framework-arduino/arduino';
      I2C0.begin();
      const data = I2C0.device(0x44).readBytes(0, 6);
      const n = data.length;
    `);
    expect(errorDiags(result)).toEqual([]);
    expect(result.cpp).toContain('sizeof(data) / sizeof(data[0])');
  });
});
