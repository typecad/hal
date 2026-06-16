// ---------------------------------------------------------------------------
// Pipeline.ts — message-processing pipeline (higher-order functions).
//
// SUPPORT_MATRIX tour for Demo #9 (untested slice):
//   §3.4  returning a function (nested function declarations — Finding B fixed)
//   §1.8  `T | null` / `T | undefined` (Finding D fixed — value-type null
//         comparison resolves to false)
//   §1.6  discriminated union of object literals → std::variant (Finding A
//         fixed — <variant> include registered)
//   §5.3  `parseInt` / `parseFloat` (Finding C fixed — .c_str())
// ---------------------------------------------------------------------------

// §1.6 — a message struct. NOTE: discriminated unions (`type M = A | B`) lower
// to `std::variant<A,B>` but member access (`m.kind`, `m.payload`) doesn't
// lower to `std::get_if`/`std::holds_alternative`, so dispatch is broken
// end-to-end (Finding E). Gated out — use a struct with a kind field.
export interface Message {
  kind: string;
  text: string;
  num: int32_t;
}

// §3.4 — returning a function. NOTE: a nested function that captures an
// enclosing param (`factor`) can't be hoisted to module level (C++ free
// functions don't capture). Use a capture-free nested function (the alias-
// mangling fix B makes the return reference resolve correctly).
let _scalerFactor: int32_t = 1;
function _scaled(x: int32_t): int32_t { return x * _scalerFactor; }
export function makeScaler(factor: int32_t): (x: int32_t) => int32_t {
  _scalerFactor = factor;
  return _scaled;
}

// §3.4 — returning a function from a parameter (predicate factory).
let _thresholdLo: int32_t = 0;
function _aboveLo(x: int32_t): boolean { return x >= _thresholdLo; }
export function makeThreshold(lo: int32_t): (x: int32_t) => boolean {
  _thresholdLo = lo;
  return _aboveLo;
}

// §5.3 — parseInt / parseFloat (Finding C fixed — .c_str() for atoi/atof).
export function parseLen(s: string): int32_t {
  return parseInt(s, 10);
}
export function parseVal(s: string): double {
  return parseFloat(s);
}

// §1.8 — `T | null` param. The `=== null` comparison on a value type now
// resolves to false (Finding D fixed), so the null branch is dead but valid.
export function safeHead(xs: int32_t[] | null): int32_t {
  if (xs === null) return -1;
  return xs[0]!;
}

// §1.8 — `T | undefined` param.
export function orDefault(x: int32_t | undefined): int32_t {
  if (x === undefined) return 99;
  return x;
}

// A Stage class (method named `process` — avoid `apply`/`call`/`bind` which
// trip the lint selector).
export class Stage {
  offset: int32_t;
  constructor(offset: int32_t) {
    this.offset = offset;
  }
  process(x: int32_t): int32_t {
    return x + this.offset;
  }
}

// §1.6 — dispatch over a Message struct (switch on kind).
export function messageValue(m: Message): int32_t {
  switch (m.kind) {
    case 'num':
      return m.num;
    case 'text':
      return m.text.length;
  }
  return 0;
}
