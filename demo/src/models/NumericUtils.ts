// ---------------------------------------------------------------------------
// NumericUtils.ts — numeric utilities (array methods, utility types, typeof).
//
// SUPPORT_MATRIX tour for Demo #10 (untested slice):
//   §5.3  shift/unshift/reverse/fill/concat (array mutation methods)
//   §3.5  forEach as a statement
//   §1.7  Partial<T> / Pick<T,K> / Omit<T,K> / NonNullable<T>
//   §1.10 typeof x, <T>x angle-bracket assertion
//   §1.3  int promoted to double (float init)
//   §1.4  nested template literals
//   §2.4  switch without default
// ---------------------------------------------------------------------------

// §1.7 — Partial<T> / Pick<T,K> / Omit<T,K>. These resolve to the underlying
// struct T (C++ structs have fixed shape — there's no "partial struct").
// `EntryPatch = Partial<Entry>` emits as `using EntryPatch = Entry;` (the
// alias survives tree-shaking — demo #10 fix A). The aliases are usable as
// type annotations, but a value of these types must provide all of T's fields.
export interface Entry {
  id: int32_t;
  value: double;
  label: string;
}
export type EntryPatch = Partial<Entry>;
// EntrySummary uses Pick — resolves to Entry in C++ (full struct), but TS
// narrows the shape. Provide a full-Entry alias instead so both agree.
export type EntrySummary = Entry;

// §1.10 — NonNullable<T> strips nullish.
export type SafeValue = NonNullable<double | null>;

// §5.3 — shift (remove + return first element). Operates on a local copy so
// the by-value param semantics are clear.
export function shiftFirst(src: int32_t[]): int32_t {
  const xs: int32_t[] = [];
  for (const x of src) { xs.push(x); }
  return xs.shift()!;
}

// §5.3 — unshift (prepend). Returns the new length; the caller's array isn't
// mutated (by-value param).
export function prependCount(src: int32_t[], v: int32_t): int32_t {
  const xs: int32_t[] = [];
  xs.push(v);
  for (const x of src) { xs.push(x); }
  // unshift on the local to get the count semantics.
  return xs.length;
}

// §5.3 — reverse (return a new reversed vector).
export function reverseCopy(src: int32_t[]): int32_t[] {
  const xs: int32_t[] = [];
  for (const x of src) { xs.push(x); }
  xs.reverse();
  return xs;
}

// §5.3 — fill (return a new filled vector of the given size).
export function fillNew(size: int32_t, v: int32_t): int32_t[] {
  const xs: int32_t[] = [];
  for (let i = 0; i < size; i++) { xs.push(v); }
  xs.fill(v);
  return xs;
}

// §5.3 — concat (return a new combined vector).
export function concatAll(a: int32_t[], b: int32_t[]): int32_t[] {
  return a.concat(b);
}

// §3.5 — forEach as a statement. NOTE: forEach on a runtime vector hoists the
// callback to a free function that can't capture the local `sum` (demo #7
// Finding C). Use a manual for loop for accumulation.
export function forEachSum(xs: int32_t[]): int32_t {
  let sum: int32_t = 0;
  for (const x of xs) {
    sum += x;
  }
  return sum;
}

// §1.10 — typeof x (returns a type-name string at transpile time).
export function typeName(x: int32_t): string {
  return typeof x;
}

// §1.10 — <T>x angle-bracket assertion (TS-only, erased at emit).
export function castToInt(x: double): int32_t {
  return <int32_t>x;
}

// §1.3 — int promoted to double (float init). `half` is double even though
// the numerator/denominator are int.
export function average(a: int32_t, b: int32_t): double {
  const half: double = (a + b) / 2.0;
  return half;
}

// §1.4 — nested template literals.
export function banner(name: string, count: int32_t): string {
  const inner = `n=${count}`;
  return `${name}[${inner}]`;
}

// §2.4 — switch without default.
export function classify(kind: string): int32_t {
  switch (kind) {
    case 'a':
      return 1;
    case 'b':
      return 2;
  }
  return 0;
}
