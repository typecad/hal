// ---------------------------------------------------------------------------
// StringRegistry.ts — §5.1 operators + destructure variants.
//
// SUPPORT_MATRIX tour for Demo #8 (untested slice):
//   §5.1  `**` exponentiation (via Math.pow), `??=`, comma operator, `void expr`
//   §1.9  array destructure default `[a = 5]`, mixed destructure + regular params
//   §1.10 `m.delete(k)` on a Map param (Finding D fixed)
// ---------------------------------------------------------------------------

// §5.1 — comma operator `(a, b)` evaluates both, returns the last.
export function commaScore(a: int32_t, b: int32_t): int32_t {
  let discarded: int32_t = a + 1;
  return (discarded = a, b);
}

// §5.1 — `void expr` discards a value.
export function voidTest(): int32_t {
  let x: int32_t = 5;
  void (x = x + 1);
  return x;
}

// §1.10 — `m.delete(k)` on a Map-typed param (Finding D fixed — no longer
// emits `delete_`).
export function deleteKey(m: Map<string, int32_t>, k: string): boolean {
  return m.delete(k);
}

// §1.8 — `??=` logical nullish assignment on a property-access left side
// (Finding I fixed). NOTE: the param lowers to `const Opts&` (read-only), so
// the `??=` write to `.val` fails on a const-ref param; copy into a mutable
// local first.
export interface Opts { val?: int32_t; }
export function nullishAssign(src: Opts): int32_t {
  let target: Opts = { val: src.val ?? 0 };
  target.val ??= 42;
  return target.val!;
}

// §1.9 — mixed destructure + regular param.
export interface Spec { a: int32_t; b: int32_t; }
export function mixedDestructure(spec: Spec, c: int32_t): int32_t {
  const { a, b } = spec;
  return a + b + c;
}

// §1.9 — array destructure default.
export function arrayDefault(values: int32_t[]): int32_t {
  const [a, b = 10] = values;
  return a! + b;
}

// §5.1 — exponentiation (via Math.pow; `**` is matrix-🟡).
export function rawExponent(base: double, exp: double): double {
  return base * Math.pow(2, exp);
}
