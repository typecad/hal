// ---------------------------------------------------------------------------
// Regression tests for bugs surfaced by demo #5 (Relay).
//
// Each test pins a specific previously-broken shape so the fixes are not
// regressed. The SUPPORT_MATRIX section references point at the documented
// pattern each fix restores.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { expectCppContains, transpile, transpileNative } from './setup';

// ── Bitwise operators on enum-class operands (SUPPORT_MATRIX §5.1) ──────────
//
// Before the fix, `flags | LinkFlag.Up` and `from.links[0] & LinkFlag.Wired`
// emitted the raw enum operands and failed g++ ("no match for 'operator|'
// ('LinkFlag' and 'LinkFlag')"). The Demo-#4 static_cast<int> fix covered
// arithmetic and comparison, but NOT bitwise (&, |, ^, <<, >>). Flag-bit enums
// composed with `a | b` or `x & MASK` need both operands cast to int.
describe('Demo #5 — bitwise ops on enum operands are static_cast-wrapped', () => {
  it('wraps both enum operands of |', () => {
    const result = transpile(`
      enum LinkFlag { None = 0, Up = 1, Wired = 16 }
      function combine(a: LinkFlag, b: LinkFlag): LinkFlag {
        return a | b;
      }
    `);
    // Both operands must be cast to int so the | is int|int.
    expectCppContains(result, ['static_cast<int>(a) | static_cast<int>(b)']);
  });

  it('wraps enum operand of & against a typed-array element (mixed int/enum)', () => {
    const result = transpile(`
      enum LinkFlag { None = 0, Wired = 16 }
      function hasLink(links: Uint8Array): boolean {
        return (links[0] & LinkFlag.Wired) !== 0;
      }
    `);
    // The enum side must be cast; the int side gets the defensive-symmetry cast.
    expect(result.cpp).toContain('static_cast<int>(LinkFlag::Wired)');
  });

  it('wraps enum operand of ^', () => {
    const result = transpile(`
      enum Mode { A = 1, B = 2 }
      function toggle(m: Mode): number {
        return m ^ Mode.A;
      }
    `);
    expectCppContains(result, ['static_cast<int>(m) ^ static_cast<int>(Mode::A)']);
  });

  it('wraps enum operand of << (shift)', () => {
    const result = transpile(`
      enum Bit { One = 1 }
      function shifted(b: Bit): number {
        return b << 4;
      }
    `);
    expectCppContains(result, ['static_cast<int>(b) << static_cast<int>(4)']);
  });
});
