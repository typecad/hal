// ---------------------------------------------------------------------------
// main.ts — number-theory explorer (cuttlefish demo #21).
//
// A mid-complexity, idiomatic TypeScript program exploring two small but
// classic number-theory amusements over a fixed range:
//
//   • a Sieve of Eratosthenes over [2, N) backed by a byte array (0 = struck,
//     1 = prime candidate),
//   • a Collatz "hailstone" sequence length computer (recursive) for each
//     start value in a small set, with the longest length recorded in a
//     Map<number, number> keyed by start value, and the highest value
//     reached along the way collected into a Set<number>,
//   • a small `Explorer` class wrapping the sieve, the results map, and the
//     peaks set, plus a driver that builds the sieve, runs each Collatz
//     start, and prints a one-line summary per start plus the aggregate
//     "biggest peak across all starts".
//
// This is the *twenty-first* demo iteration. Like #15–#20 it is deliberately
// readable — real, everyday TypeScript — and is *not* a feature-exhaustion
// test. It deliberately picks a different data shape from #18–#20 (which were
// CRUD-over-struct-array and `Map<string, number[]>`):
//
//   • a **byte-array sieve** (`int8_t[]` → `std::vector<int32_t>`) with indexed
//     read/write,
//   • a **`Map<number, number>` of *primitive* values** — the clean lowering
//     path, a deliberate contrast with demo #20's container-valued map (which
//     surfaced three gaps),
//   • a **`Set<number>`** of peak values,
//   • a **recursive free function** (`collatzLength`), and
//   • **`for...of` over `Set.values()`** (lowers to `__tc_setValues`).
//
// The first compile attempt surfaced one real transpiler gap — **a typed-array
// class field lowered to invalid C++** — which is now **fixed** in the
// transpiler (a new `TS2CPP_TYPED_ARRAY_FIELD` semantic gate + a
// `no-typed-array-field` lint rule that persists into new `cuttlefish create`
// projects). See *README*.
//
// The previous iteration (#20, gradebook) is preserved in `demo20-backup/`.
// ---------------------------------------------------------------------------

// Upper bound (exclusive) of the sieve. Fixed width so the loop bound is
// sign-compare clean (the counter is int32_t; the bound is int32_t too).
const SIEVE_LIMIT: int32_t = 30;

// The start values whose Collatz sequences we explore.
const STARTS: int32_t[] = [7, 19, 27];

// Classification of an integer for reporting. `const enum` so members are
// inlined (a plain `enum` is lint-gated in scaffolded projects — by design).
const enum Kind {
  Prime = 0,
  Composite = 1,
}

// ---------------------------------------------------------------------------
// Sieve of Eratosthenes.
//
// Returns a byte array of length `limit` where cell [i] is 1 if i is prime
// and 0 otherwise (0 and 1 are treated as non-prime). A free function.
//
// NOTE (see README — Findings): the most idiomatic element type for a sieve
// is `Uint8Array`. Typed arrays are supported ONLY as function-local stack
// buffers; every other storage class is gated. Concretely:
//   (1) `function buildSieve(...): Uint8Array` that *returns* the array is
//       rejected by `cuttlefish/no-typed-array-return` /
//       `TS2CPP_TYPED_ARRAY_RETURN` (SUPPORT_MATRIX §3.3) — a typed array
//       lowers to a stack-local C array, so returning one dangles. By-design.
//   (2) Mutating a caller-provided `Uint8Array` parameter is rejected by
//       `cuttlefish/no-array-param-content-mutation` /
//       `TS2CPP_ARRAY_PARAM_MUTATION` (§3.2) — an array parameter is a
//       by-value std::vector copy. By-design.
//   (3) Holding the sieve in a typed-array *field* (`private sieve:
//       Uint8Array`) is rejected by `cuttlefish/no-typed-array-field` /
//       `TS2CPP_TYPED_ARRAY_FIELD` (§1.5) — the field lowers to `uint8_t*`
//       but `new Uint8Array(N)` lowers to a brace-init-list that cannot
//       initialize a pointer, and a raw pointer field has no lifecycle.
//       (This gate was added by this demo — Finding C, FIXED.)
// (`.length` on a function-LOCAL typed array does work — it lowers to
// `sizeof(arr)/sizeof(arr[0])` — but that doesn't help a class field.)
// The supported workaround is the one used here: keep the sieve in a plain
// `int8_t[]` (a std::vector<int32_t>). Plain arrays lower to std::vector,
// which *is* safely returnable by value (unlike typed arrays), so the
// idiomatic "build and return" shape works. The caller (Explorer.prepare)
// stores the returned vector on the instance and owns it for the Explorer's
// lifetime.
// ---------------------------------------------------------------------------
function buildSieve(limit: int32_t): int8_t[] {
  const sieve: int8_t[] = [];
  // Allocate `limit` cells, all starting at 0.
  for (let i: int32_t = 0; i < limit; i = i + 1) {
    sieve.push(0);
  }
  // 0 and 1 are not prime by definition (already 0); mark everything >= 2 as
  // a prime candidate.
  for (let i: int32_t = 2; i < limit; i = i + 1) {
    sieve[i] = 1;
  }
  // Strike composites. Only need to scan up to sqrt(limit); a plain i*i bound
  // is enough here and avoids a Math.sqrt call.
  for (let i: int32_t = 2; i * i < limit; i = i + 1) {
    if (sieve[i] === 0) {
      continue;
    }
    for (let j: int32_t = i * i; j < limit; j = j + i) {
      sieve[j] = 0;
    }
  }
  return sieve;
}

// The Collatz (3n+1) sequence length for a positive start value — the number
// of steps to reach 1. Pure recursion; each step halves an even n or maps an
// odd n to 3n+1. Returns the *step count* (so collatz(1) === 0).
function collatzLength(n: int32_t): int32_t {
  if (n <= 1) {
    return 0;
  }
  if (n % 2 === 0) {
    return 1 + collatzLength(n / 2);
  }
  return 1 + collatzLength(3 * n + 1);
}

// The highest value reached along the Collatz sequence from `n`, including
// `n` itself and 1. Computed iteratively (avoids deepening the recursion
// already used by collatzLength).
function collatzPeak(n: int32_t): int32_t {
  let peak: int32_t = n;
  let current: int32_t = n;
  while (current > 1) {
    if (current % 2 === 0) {
      current = current / 2;
    } else {
      current = 3 * current + 1;
    }
    if (current > peak) {
      peak = current;
    }
  }
  return peak;
}

// Classify a value against a sieve. A small wrapper free function: reads the
// array by index, maps the bit to the enum. Used from the Explorer method
// below (a class method calling a module-scope free function — the demo #18
// lowering).
function classify(sieve: int8_t[], n: int32_t): Kind {
  if (n < 2) {
    return Kind.Composite;
  }
  if (sieve[n] === 1) {
    return Kind.Prime;
  }
  return Kind.Composite;
}

// A short label for a Kind. Numeric switch with a default branch.
function kindLabel(k: Kind): string {
  switch (k) {
    case Kind.Prime:
      return 'prime';
    case Kind.Composite:
      return 'composite';
    default:
      return '?';
  }
}

// ---------------------------------------------------------------------------
// Explorer: wraps the sieve, the per-start Collatz-length results, and the
// set of "peak" values reached. Class -> C++ class; `new Explorer()` returns
// a pointer.
// ---------------------------------------------------------------------------
class Explorer {
  // The precomputed sieve. A byte per candidate: 1 = prime, 0 = composite.
  // (int8_t[] rather than Uint8Array — see Finding A/C.)
  private sieve: int8_t[] = [];

  // start value -> Collatz sequence length. A Map<number, number> of
  // *primitive* values — the clean lowering path. (Contrast with demo #20's
  // Map<string, number[]>, whose container values surfaced three gaps.)
  private lengths: Map<int32_t, int32_t> = new Map();

  // The set of peak values reached across all explored starts. A Set<number>.
  private peaks: Set<int32_t> = new Set();

  // Build (or rebuild) the sieve over [0, limit). Stores the vector returned
  // by the free `buildSieve` helper on the instance. The Explorer owns the
  // array for its lifetime (see Finding A — a typed-array return/field is not
  // a supported lowering, so the sieve is a plain int8_t[] here).
  prepare(limit: int32_t): void {
    this.sieve = buildSieve(limit);
  }

  // Explore one start value: record its Collatz length, and insert its peak
  // into the shared peaks set. Idiomatic Map.set / Set.add.
  explore(start: int32_t): void {
    const length: int32_t = collatzLength(start);
    this.lengths.set(start, length);
    const peak: int32_t = collatzPeak(start);
    this.peaks.add(peak);
  }

  // Whether a value is prime, per the sieve. Delegates to the free `classify`
  // helper.
  isPrime(n: int32_t): boolean {
    return classify(this.sieve, n) === Kind.Prime;
  }

  // The Collatz length recorded for a start, or -1 if it was never explored.
  // Map.has guards the lookup; with a primitive value type the `Map.get` +
  // `=== undefined` path is NOT needed (see the SUPPORT_MATRIX §1.5 caveat —
  // for container values it would be a build error; for primitives it is fine,
  // but `.has` is clearer and matches the demo's idiom).
  lengthFor(start: int32_t): int32_t {
    if (!this.lengths.has(start)) {
      return -1;
    }
    return this.lengths.get(start)!;
  }

  // The single highest peak across all explored starts, or -1 if none were
  // explored. Iterates a `for...of` over the Set's values (lowers to
  // `__tc_setValues` → std::vector, then a const-ref for-range).
  biggestPeak(): int32_t {
    let best: int32_t = -1;
    for (const p of this.peaks.values()) {
      if (p > best) {
        best = p;
      }
    }
    return best;
  }

  // Print a one-line summary per start: its primality, its Collatz length,
  // and its individual peak. Iterates the caller-supplied roster by index
  // (the demo #20 idiom — no Array.from / tuple destructuring of Map entries).
  printReport(roster: int32_t[]): void {
    const count: int32_t = roster.length;
    for (let i: int32_t = 0; i < count; i = i + 1) {
      const start: int32_t = roster[i]!;
      const k: Kind = classify(this.sieve, start);
      const length: int32_t = this.lengthFor(start);
      const peak: int32_t = collatzPeak(start);
      console.log(
        `${start}: ${kindLabel(k)}, collatz=${length}, peak=${peak}`,
      );
    }
  }
}

// Entry point.
function main(): void {
  const ex: Explorer = new Explorer();

  // Build the sieve, then explore each start value.
  ex.prepare(SIEVE_LIMIT);
  const count: int32_t = STARTS.length;
  for (let i: int32_t = 0; i < count; i = i + 1) {
    ex.explore(STARTS[i]!);
  }

  // A couple of primality spot-checks from the driver (not part of the
  // per-start report, which classifies the start itself).
  console.log(`prime_2=${ex.isPrime(2)}`);
  console.log(`prime_9=${ex.isPrime(9)}`);
  console.log(`prime_29=${ex.isPrime(29)}`);

  // The per-start report.
  console.log('---');
  ex.printReport(STARTS);
  console.log('---');

  // Aggregate: the highest value reached by any explored sequence.
  console.log(`biggest_peak=${ex.biggestPeak()}`);

  // How many distinct primes are in the sieve over [2, SIEVE_LIMIT)? Walk the
  // array once and count cells marked prime.
  let primeCount: int32_t = 0;
  for (let i: int32_t = 2; i < SIEVE_LIMIT; i = i + 1) {
    if (ex.isPrime(i)) {
      primeCount = primeCount + 1;
    }
  }
  console.log(`primes_below_${SIEVE_LIMIT}=${primeCount}`);
  console.log('done');
}

main();
