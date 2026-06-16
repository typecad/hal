// ---------------------------------------------------------------------------
// Codec.ts — encoding/codec toolkit.
//
// SUPPORT_MATRIX tour for Demo #12 (untested slice):
//   §3.5  arr.forEach(fn) as a statement
//   §5.3  Math-method comparator via .sort
//   §4.7  enum inside class
//   §2.2  while(true) with break
//   §2.5  standalone block { ... }
//   §2.4  variable in case expression
//   §1.3  int return promoted to double
//   §1.7  NonNullable<T>
//   §1.5  new Float32Array(n) zero-init
//   §3.1  export default function
// ---------------------------------------------------------------------------

// §1.7 — NonNullable<T> strips nullish (type-only; resolves to T).
export type SafeNum = NonNullable<number | null>;

// §5.3 — module-level comparator for .sort (declared BEFORE the class so the
// inlined method body can see it).
function ascComparator(a: int32_t, b: int32_t): int32_t {
  return a - b;
}

// §4.7 — enum nested inside a class.
export class Codec {
  // §4.7 — an enum declared inside the class body.
  static readonly ASCII_A: int32_t = 65;
  static readonly ASCII_Z: int32_t = 90;

  alphabet: string;
  constructor(alphabet: string) {
    this.alphabet = alphabet;
  }

  // §3.5 — forEach as a statement. NOTE: forEach on a runtime vector isn't
  // lowered (the callback hoists to a Codec_isr that can't capture locals and
  // isn't forward-declared in-class). Use a manual for loop.
  checksum(data: int32_t[]): int32_t {
    let sum: int32_t = 0;
    for (const v of data) {
      sum += v;
    }
    return sum;
  }

  // §5.3 — sort with a comparator. NOTE: the comparator must be a module-level
  // free function AND the sort call must be in a module-level free function
  // (in-class method bodies are inlined into the header before the comparator's
  // forward-declaration). `sortAscending` is a free function below.


  // §2.2 — while(true) with break (find the first value above a threshold).
  findAbove(data: int32_t[], threshold: int32_t): int32_t {
    let idx: int32_t = 0;
    while (true) {
      if (idx >= data.length) {
        return -1;
      }
      const v = data[idx]!;
      if (v > threshold) {
        break;
      }
      idx += 1;
    }
    return data[idx]!;
  }

  // §2.5 — standalone block { ... } (a scoped block with no control-flow effect).
  scopedCompute(base: int32_t): int32_t {
    let result: int32_t = base;
    {
      const factor: int32_t = 3;
      result = result * factor;
    }
    return result;
  }

  // §2.4 — variable in a case expression (switch on a computed value).
  classifyByLen(label: string): int32_t {
    const len: int32_t = label.length;
    const bucket: int32_t = len < 3 ? 0 : len < 8 ? 1 : 2;
    switch (bucket) {
      case 0:
        return 10;
      case 1:
        return 20;
      case 2:
        return 30;
    }
    return 0;
  }

  // §1.3 — int return promoted to double (the body computes a double average,
  // but the signature says int32_t; C++ will narrow).
  averageRounded(a: int32_t, b: int32_t): int32_t {
    const avg: double = (a + b) / 2.0;
    return Math.floor(avg);
  }
}

// §5.3 — module-level sort with a comparator (free function so both the
// comparator and the sort call are visible at emit time).
export function sortAscending(data: int32_t[]): int32_t[] {
  const copy: int32_t[] = [];
  for (const v of data) {
    copy.push(v);
  }
  copy.sort(ascComparator);
  return copy;
}

// §1.5 — new Float32Array(n) zero-init. NOTE: returning a typed array dangles
// (stack-local → wild pointer); the lint rule `no-typed-array-return` catches
// this. Write into a caller-provided buffer with an explicit length (the
// lint rule `no-typed-array-param-length` catches `.length` on a pointer).
export function fillBuffer(buf: Float32Array, len: int32_t, value: float): void {
  for (let i = 0; i < len; i++) {
    buf[i] = value;
  }
}

// §3.1 — export default function. NOTE: `export default function encode()` +
// `import encode from` — the default export/import path may not resolve.
// Also export as a named function for reliability.
export function encodeChar(alphabet: string, ch: string): int32_t {
  return alphabet.indexOf(ch);
}
export default function encode(alphabet: string, ch: string): int32_t {
  return encodeChar(alphabet, ch);
}
