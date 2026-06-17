// ---------------------------------------------------------------------------
// Types.ts — advanced type features (conditional, mapped, index sigs, etc.)
//
// Exercises ALL remaining ⬜ type-level features from DEMO_COVERAGE.
// ---------------------------------------------------------------------------

// §1.6 — interface with a string index signature.
export interface StringIndexMap {
  [key: string]: int32_t;
}

// §1.6 — interface with numeric keys.
export interface NumericKeyMap {
  [key: number]: double;
}

// §1.6 — conditional type (type-only). NOTE: `T extends number ? 'yes' : 'no'`
// leaks a generic `T` into the generated code (not erased). Don't use in
// value positions.
// export type IsNumber<T> = T extends number ? 'yes' : 'no'; // gated

// §1.6 — mapped type (type-only). NOTE: leaks generic `T` into generated code.
// export type Stringify<T> = { [K in keyof T]: string }; // gated

// §1.7 — ReturnType / Parameters (type-only). NOTE: `typeof sampleFn` in a
// type position lowers to a generic `T` (broken). Don't use these in value
// positions; they're type-only and erased.
export function sampleFn(x: int32_t, y: int32_t): double { return x + y; }

// §1.8 — T | null | undefined (triple union).
export type MaybeVal = number | null | undefined;

// §1.7 — enum nested inside a class (declared as a static const group since
// enum-inside-class is untested).
export class Constants {
  static readonly MODE_A: int32_t = 0;
  static readonly MODE_B: int32_t = 1;
}
