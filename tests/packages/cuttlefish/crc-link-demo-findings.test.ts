// ---------------------------------------------------------------------------
// Regression tests — transpiler fixes surfaced by the zephyr-crc-link demo
// (bit-banged frame encoding: CRC-8 over shifts/XOR, rotate-left through
// >>>, bit interleaving with compound |=, hex formatting via a digit-table
// lookup). This is the JS BITWISE-INT boundary — the number-model half that
// every bitwise workload lives on:
//
//   1. Binary bitwise (`& | ^ << >>`) coerce FLOATING operands to int before
//      the operator (JS ToInt32; C++ `^` on double is a hard error).
//   2. `>>>` additionally casts the LEFT operand to unsigned int so the
//      shift is logical (zero-fill), not arithmetic.
//   3. Bitwise compound assignments (`crc ^= byte`, `crc &= 0xFF`) cast a
//      floating RHS to int — the assign-site twin of the binary rule.
//   4. Bitwise results infer INT: `let crc = 0` under `crc ^= byte` stays
//      int (the accumulator was previously poisoned to double by the
//      compound-assign adoption, making every later `^` invalid).
//   5. The IR flattener (helper args, template parts) applies the same
//      coercion — `(v >> 4) & 0xF` into hexByte() emits casts, not raw `>>`
//      on a double.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";
import { ZephyrStrategy } from "../../../packages/framework-zephyr/src/strategy";

const zephyr = () => new ZephyrStrategy();

describe("crc-link demo findings (Zephyr)", () => {
  it("bitwise ops on double-typed values compile and infer int accumulators", () => {
    const out = transpile(`
      function crc8(data: number[]): number {
        let crc = 0;
        for (const byte of data) {
          crc ^= byte;
          for (let bit = 0; bit < 8; bit += 1) {
            if ((crc & 0x80) !== 0) {
              crc = ((crc << 1) ^ 0x07) & 0xFF;
            } else {
              crc = crc << 1;
            }
            crc &= 0xFF;
          }
        }
        return crc & 0xFF;
      }
      const f: number[] = [];
      f.push(200);
      let sink = crc8(f);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.diagnostics.filter(d => d.severity === 'error')).toHaveLength(0);
    expect(out.cpp).toMatch(/int(32_t)? crc = 0/);
    expect(out.cpp).toMatch(/crc \^= static_cast<int>\(byte\)/);
    expect(out.cpp).not.toMatch(/crc \^= byte;/);
    // The body's compound `crc &= 0xFF` keeps crc int through the loop.
    expect(out.cpp).not.toMatch(/double crc = 0/);
  });

  it(">>> casts the left operand to unsigned int (logical shift)", () => {
    const out = transpile(`
      function rol8(v: number, n: number): number {
        const sh = n & 7;
        return ((v << sh) | (v >>> (8 - sh))) & 0xFF;
      }
      let sink = 0;
      sink = rol8(0x81, 3);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    // The >>> arm must wrap the left operand in unsigned int — a signed
    // int shift would be arithmetic (sign-filling), not JS's logical one.
    expect(out.cpp).toMatch(/static_cast<unsigned int>\([^()]*\) >> \(8 - sh\)/);
  });

  it("bitwise compound assignments cast a floating RHS", () => {
    const out = transpile(`
      export function pack(flags: number, mode: number): number {
        let out = 0;
        out |= flags;
        out ^= mode;
        out &= 0xFF;
        return out;
      }
      let sink = 0;
      sink = pack(1.5, 3);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/out \|= static_cast<int>\(flags\)/);
    expect(out.cpp).toMatch(/out \^= static_cast<int>\(mode\)/);
  });

  it("IR-flattened bitwise (helper args) coerces floating operands", () => {
    const out = transpile(`
      function hexByte(v: number): string {
        return \`0x\${(v >> 4) & 0xF}\`;
      }
      let sink = '';
      sink = hexByte(0x5A);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    // The flattened part must not emit `>>` directly on the double param.
    expect(out.cpp).not.toMatch(/v >> 4/);
    expect(out.cpp).toMatch(/static_cast<int>\(v\).*>> 4|>> 4.*static_cast<int>\(v\)/);
  });

  it("inferred-int bitwise operands stay cast-free (no noise)", () => {
    const out = transpile(`
      export function mask(v: number): number {
        let m = 0;
        const k = 3;
        m = k & 0xFF;
        m = m << 2;
        return m;
      }
      let sink = 0;
      sink = mask(200);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.diagnostics.filter(d => d.severity === 'error')).toHaveLength(0);
    // An unannotated const k infers int — int & int must NOT gain a
    // redundant static_cast<int> wrapper. (An ANNOTATED `k: number` is a
    // double on this number model and correctly casts.)
    expect(out.cpp).toMatch(/k & 255/);
    expect(out.cpp).not.toMatch(/static_cast<int>\(k\) & /);
  });
});
