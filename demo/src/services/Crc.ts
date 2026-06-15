// ---------------------------------------------------------------------------
// Crc.ts — CRC-8 checksum and bitmask helpers.
//
// SUPPORT_MATRIX tour:
//   §1.5  Uint8Array element access + .length
//   §5.1  bitwise operators (& | ^ << >> ~) and compound assignment
//         (&= ^= <<=)
//   §1.2  uint8_t / int16_t pass-through annotations
// ---------------------------------------------------------------------------

import { CRC_POLY } from '../models/Types';

// §5.1 — bitwise-heavy CRC-8 (polynomial 0x07, MSB-first). Uses <<=, ^=, &=
// compound assignment throughout. Returns a uint8_t.
//
// NOTE: `len` is passed explicitly because `.length` on a typed-array PARAMETER
// does not lower to valid C++ (the parameter decays to a raw pointer and
// loses its count). The `no-typed-array-param-length` lint rule enforces
// this. Locally-declared typed arrays (e.g. `unpack32`'s return) still
// support .length.
export function crc8(data: Uint8Array, len: int16_t): uint8_t {
  let crc: uint8_t = 0x00;
  for (let i = 0; i < len; i++) {
    crc = crc ^ data[i]!;
    for (let j = 0; j < 8; j++) {
      // §5.1 — bitwise AND with 0x80, shift, conditional XOR.
      if ((crc & 0x80) !== 0) {
        crc = ((crc << 1) ^ CRC_POLY) & 0xFF;
      } else {
        crc = crc << 1;
      }
    }
  }
  return crc;
}

// §5.1 — pack 4 bytes into a uint32_t using <<= and |=. Exercises 32-bit
// shifts and OR composition.
export function pack32(b0: uint8_t, b1: uint8_t, b2: uint8_t, b3: uint8_t): uint32_t {
  let v: uint32_t = 0;
  v = v | b0;
  v = v << 8;
  v = v | b1;
  v = v << 8;
  v = v | b2;
  v = v << 8;
  v = v | b3;
  return v;
}

// §5.1 — unpack a uint32_t into 4 bytes with >>= and &=. Writes into a
// caller-provided output array (out-param) rather than returning a new array,
// because a returned Uint8Array lowers to a stack-local that dangles after the
// function returns (the typed-array lifetime gap). The caller owns the array.
export function unpack32Into(v: uint32_t, out: Uint8Array): void {
  // §1.5 — typed-array element assignment.
  out[0] = (v >> 24) & 0xFF;
  out[1] = (v >> 16) & 0xFF;
  out[2] = (v >> 8) & 0xFF;
  out[3] = v & 0xFF;
}

// §5.1 — count set bits (population count) via a loop and &=.
export function popcount(v: uint8_t): int16_t {
  let n: uint8_t = v;
  let count: int16_t = 0;
  while (n !== 0) {
    count = count + 1;
    n = n & (n - 1); // clear the lowest set bit
  }
  return count;
}
