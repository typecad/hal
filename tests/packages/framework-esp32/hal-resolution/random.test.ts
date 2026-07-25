import { describe, it, expect } from 'vitest';
import { lowerRandom } from '../../../../packages/framework-esp32/src/lowering/random';
import { transpile, transpileEsp32Strategy } from '../../../setup';

describe('random lowering', () => {
  it('random.int → esp_random() masked to 31-bit non-negative', () => {
    const out = lowerRandom({ operation: 'random.int' } as any);
    expect(out.expression).toBeDefined();
    expect(out.expression).toContain('esp_random()');
    expect(out.expression).toContain('0x7FFFFFFF');
    // Must NOT lower to the Arduino random() symbol (undefined on ESP-IDF).
    expect(out.expression).not.toMatch(/\brandom\s*\(/);
  });

  it('random.range(min, max) → modulo on esp_random()', () => {
    const out = lowerRandom({ operation: 'random.range', min: 1, max: 10 } as any);
    expect(out.expression).toBeDefined();
    expect(out.expression).toContain('esp_random()');
    expect(out.expression).toContain('%');
    expect(out.expression).toContain('1');
    expect(out.expression).toContain('10');
  });

  it('random.range with runtime-expression bounds is preserved', () => {
    const out = lowerRandom({ operation: 'random.range', min: 'lo', max: 'hi' } as any);
    expect(out.expression).toContain('lo');
    expect(out.expression).toContain('hi');
    expect(out.expression).toContain('esp_random()');
  });

  it('random.seed → no-op code (hardware RNG self-seeds)', () => {
    const out = lowerRandom({ operation: 'random.seed', seed: 42 } as any);
    // Returns code (statement context), not an expression.
    expect(out.code).toBeDefined();
    // No esp_random() / srand() call — the hardware RNG ignores user seeds.
    expect(out.expression).toBeUndefined();
  });

  it('unknown random.* op throws', () => {
    expect(() => lowerRandom({ operation: 'random.bogus' } as any)).toThrow();
  });
});

describe('random lowering end-to-end', () => {
  it('ESP32: Random.upTo() lowers to esp_random() (not Arduino random())', () => {
    const result = transpileEsp32Strategy(`
      import { Random } from '@typecad/hal';
      export function setup() {
        const n = Random.upTo(10);
        console.log(n);
      }
    `);
    expect(result.cpp).toContain('esp_random()');
    // The Arduino random() symbol must not leak into ESP-IDF output.
    expect(result.cpp).not.toMatch(/\brandom\s*\(/);
    // The forced include for the hardware RNG header should be present.
    expect(result.cpp).toMatch(/esp_random\.h/);
  });

  it('ESP32: Random.between(min, max) lowers to esp_random() modulo', () => {
    const result = transpileEsp32Strategy(`
      import { Random } from '@typecad/hal';
      export function setup() {
        const n = Random.between(1, 100);
        console.log(n);
      }
    `);
    expect(result.cpp).toContain('esp_random()');
    expect(result.cpp).toContain('%');
  });

  it('Arduino: Random.upTo() still lowers to Arduino random() (no regression)', () => {
    const result = transpile(`
      import { Random } from '@typecad/hal';
      export function setup() {
        const n = Random.upTo(10);
        console.log(n);
      }
    `, { target: 'arduino', platformContext: { frameworkData: { buildTarget: 'arduino:avr:uno' } } });
    expect(result.cpp).toMatch(/\brandom\s*\(/);
    expect(result.cpp).not.toContain('esp_random()');
  });
});

