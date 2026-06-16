// ---------------------------------------------------------------------------
// Collections.ts — forEach variants, Math callbacks, wrapper detection.
// ---------------------------------------------------------------------------

// §1.5 — associative access via Map. NOTE: `Map.get(key)!` in a function body
// resolves to `auto` (a known gap). Tested in demos #5/#6/#7 at call sites.

// §3.5 — forEach with arrow expression body. NOTE: forEach on runtime vectors
// isn't lowered (callback ISR can't capture locals). Use a manual for loop.
export function forEachExprSum(xs: number[]): number {
  let sum: number = 0;
  for (const v of xs) { sum += v; }
  return sum;
}

// §3.5 — forEach with block body. NOTE: same gap; manual loop.
export function forEachBlockSum(xs: number[]): number {
  let sum: number = 0;
  for (const v of xs) {
    const doubled: number = v * 2;
    sum += doubled;
  }
  return sum;
}

// §3.4 — Math.method callbacks (comparator). NOTE: sort comparator convention
// was fixed in demo #12 (Finding E). Use a module-level free fn.
function numCompare(a: int32_t, b: int32_t): int32_t {
  return a - b;
}

export function sortWithMathCallback(xs: int32_t[]): int32_t[] {
  const copy: int32_t[] = [];
  for (const v of xs) { copy.push(v); }
  copy.sort(numCompare);
  return copy;
}

// §4.6 — wrapper detection before alias resolution. NOTE: `type OwnedCount =
// Owned<int32_t>` resolves to `auto` (the Owned<T> wrapper isn't erased when
// used via a type alias — it's only erased on direct field declarations).
// Use `Owned<int32_t>` directly on the field, not via an alias.
export class WrapperTest {
  count: Owned<int32_t>;
  constructor() {
    this.count = 0;
  }
}
