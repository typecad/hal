import { describe, it, expect } from 'vitest';
import {
  lowerRandom,
  randomInitLines,
} from '../../../../packages/framework-zephyr/src/lowering/random';
import { lowerHalOp } from '../../../../packages/framework-zephyr/src/lowering/index';
import { setActiveChip } from '../../../../packages/framework-zephyr/src/chips/index';
import { XIAO_BLE } from '../../../../packages/framework-zephyr/src/chips/xiao-ble';

setActiveChip(XIAO_BLE);

describe('random init block', () => {
  it('emits CUTTLEFISH_RANDOM markers + the entropy tap + xorshift32 PRNG', () => {
    const lines = randomInitLines().join('\n');
    expect(lines).toContain('// CUTTLEFISH_RANDOM_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_RANDOM_END');
    // The Zephyr entropy tap the PRNG seeds from.
    expect(lines).toContain('#include <zephyr/random/random.h>');
    expect(lines).toContain('sys_rand_get');
    // The xorshift32 state + advance step.
    expect(lines).toContain('static uint32_t __tc_rand_state');
    expect(lines).toContain('x ^= x << 13');
    expect(lines).toContain('x ^= x >> 17');
    expect(lines).toContain('x ^= x << 5');
    // The 31-bit mask so random.int is always non-negative.
    expect(lines).toContain('0x7FFFFFFFU');
  });

  it('uses AUTOSAR-compliant casts (no C-style casts)', () => {
    const lines = randomInitLines().join('\n');
    expect(lines).toContain('static_cast');
    // No C-style numeric casts like `(uint32_t)x` — the open-paren-prefixed
    // form. static_cast<uint32_t>(x) is fine (no leading paren before the type).
    expect(lines).not.toMatch(/\(\s*(?:uint32_t|int32_t)\s*\)\s*\w/);
  });

  it('guards the entropy seed against a zero return (xorshift32 needs non-zero)', () => {
    const lines = randomInitLines().join('\n');
    // The lazy seed path remaps a 0 entropy word to a non-zero odd constant.
    expect(lines).toContain('0x9E3779B9U');
  });
});

describe('random lowering — value-returning ops (expressions)', () => {
  it('int → __tc_rand_int() (non-negative 31-bit)', () => {
    expect(lowerRandom({ operation: 'random.int' } as any))
      .toEqual({ expression: '__tc_rand_int()' });
  });

  it('range(5, 10) → __tc_rand_range(5, 10)', () => {
    expect(lowerRandom({ operation: 'random.range', min: 5, max: 10 } as any))
      .toEqual({ expression: '__tc_rand_range(5, 10)' });
  });

  it('range(0, n) collapses to the single-arg upTo form', () => {
    // Random.upTo(n) lowers to random.range with min=0; emit the 0 form.
    expect(lowerRandom({ operation: 'random.range', min: 0, max: 100 } as any))
      .toEqual({ expression: '__tc_rand_range(0, 100)' });
  });

  it('range with runtime-expression bounds passes them through', () => {
    expect(lowerRandom({ operation: 'random.range', min: 'lo', max: 'hi' } as any))
      .toEqual({ expression: '__tc_rand_range(lo, hi)' });
  });
});

describe('random lowering — seed (statement)', () => {
  it('seed → __tc_rand_seed with a uint32_t cast', () => {
    expect(lowerRandom({ operation: 'random.seed', seed: 42 } as any))
      .toEqual({ code: '__tc_rand_seed(static_cast<uint32_t>(42));' });
  });

  it('seed with a runtime expression passes it through', () => {
    expect(lowerRandom({ operation: 'random.seed', seed: 'analogRead(A0)' } as any))
      .toEqual({ code: '__tc_rand_seed(static_cast<uint32_t>(analogRead(A0)));' });
  });

  it('tolerates an absent seed (manifest validator probe)', () => {
    // The minimal probe sends no seed field; the lowering must still lower.
    expect(lowerRandom({ operation: 'random.seed' } as any))
      .toEqual({ code: '__tc_rand_seed(static_cast<uint32_t>(0));' });
  });
});

describe('lowerHalOp dispatch — random.* routes to lowerRandom', () => {
  it('routes random.int', () => {
    expect(lowerHalOp({ operation: 'random.int' } as any))
      .toEqual({ expression: '__tc_rand_int()' });
  });

  it('routes random.range', () => {
    expect(lowerHalOp({ operation: 'random.range', min: 1, max: 6 } as any))
      .toEqual({ expression: '__tc_rand_range(1, 6)' });
  });

  it('routes random.seed', () => {
    expect(lowerHalOp({ operation: 'random.seed', seed: 7 } as any))
      .toEqual({ code: '__tc_rand_seed(static_cast<uint32_t>(7));' });
  });
});
