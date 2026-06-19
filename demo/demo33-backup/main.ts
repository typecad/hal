// ---------------------------------------------------------------------------
// main.ts — Sensor statistics over a fixed sample window
//                                  (cuttlefish demo #33, Arduino AVR target).
//
// A mid-complexity, idiomatic TypeScript program modelling the bread-and-butter
// embedded pattern: take a batch of samples, compute running statistics, and
// report. Everything runs ONCE in `setup()` and the auto-generated `loop()`
// stays empty — the natural shape of a "compute and report" sketch with no
// periodic work.
//
// AVR (ATmega328P, 2KB RAM, no `<vector>`, no heap, no `<iostream>`) imposes
// real constraints that shape the program's data layout:
//
//   • The sample window is a FIXED LITERAL array (`const SAMPLES = [...]`).
//     On AVR a non-mutated local/top-level array literal lowers to a fixed-
//     size C array `int32_t[N]` — the only array storage the target supports.
//     A dynamically-grown array (`.push` in a loop, or a class field/param/
//     return annotated `T[]`) would need `std::vector`, which AVR does not
//     have; the transpiler now rejects those at build time
//     (`TS2CPP_NO_VECTOR_STORAGE`, SUPPORT_MATRIX §1.5 AVR note).
//
//   • Owned mutable state lives in a class with SCALAR fields only
//     (`Accumulator`: sum/count/min/max). This lowers to a POD-ish C++ struct.
//
//   • The report is built by STRING CONCATENATION (not `.push`+`.join` on a
//     growable `string[]`), so no growable array storage is needed.
//
// The program is built from:
//
//   • **`Accumulator`** — running min/max/sum/count over scalar fields.
//   • **`computeStats`** — folds the fixed window into an `Accumulator` and
//     returns a `Stats` snapshot.
//   • **`Stats`** — a POD record (interface → struct) returned by value.
//   • **`report`** — a multi-line summary built via string concatenation.
//
// This is the **thirty-third** demo iteration. It is the FIRST to target the
// **Arduino AVR toolchain** (`arduino:avr:uno`) — every prior demo (#1–#32)
// compiled against the native `g++` toolchain. AVR is a genuinely different
// compilation environment (`int` is 16-bit; no STL containers/strings/
// iostream; no exceptions/RTTI; heap allocation discouraged), and the
// transpiler's AVR support had never been exercised end-to-end by a demo
// before this one.
//
// Idiomatic constraints honored up front (per SUPPORT_MATRIX / eslint rules):
// only `const enum`; no `any`; no typed-array fields/returns; no object
// spread; no `instanceof`; no `keyof`/conditional/mapped types; no
// `String.*`/`Number.*` statics (§5.4); no `delete` on non-Map collections;
// no comparing a `Map.get()` result to `undefined`; and (AVR-specific) no
// dynamically-grown array fields/params/returns (§1.5 AVR note).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

// A raw ADC-style sample. The synthetic driver produces values in this range.
const SAMPLE_MIN: int32_t = 0;
const SAMPLE_MAX: int32_t = 1023;

// The fixed sample window. A LITERAL top-level array — on AVR this lowers to a
// fixed-size C array `int32_t[N]`, the only array storage the target supports.
// Pre-seeded with a rising ramp plus two injected outliers (a floor at index 3
// and a ceiling at index 9) so the report shows non-trivial min/max.
const SAMPLES: int32_t[] = [
  0, 1, 2, 0, 4, 5, 6, 7, 8, 1023, 10, 11,
];

// ---------------------------------------------------------------------------
// Records.
// ---------------------------------------------------------------------------

// The summary of one batch of samples. A plain `interface` lowers to a POD
// C++ struct returned by value.
interface Stats {
  min: int32_t;
  max: int32_t;
  sum: int32_t;
  count: int32_t;
}

// ---------------------------------------------------------------------------
// Accumulator — running min/max/sum/count over scalar fields only. This is the
// AVR-appropriate shape for owned mutable state: no array field (which would
// need std::vector), just fixed-width scalars.
// ---------------------------------------------------------------------------

class Accumulator {
  sum: int32_t;
  count: int32_t;
  min: int32_t;
  max: int32_t;

  constructor() {
    this.sum = 0;
    this.count = 0;
    this.min = SAMPLE_MAX;
    this.max = SAMPLE_MIN;
  }

  // Fold one sample into the running aggregates.
  add(value: int32_t): void {
    this.sum = this.sum + value;
    this.count = this.count + 1;
    if (value < this.min) {
      this.min = value;
    }
    if (value > this.max) {
      this.max = value;
    }
  }

  // Integer average of the accumulated samples (0 if empty).
  average(): int32_t {
    return this.count > 0 ? this.sum / this.count : 0;
  }

  // Snapshot the running aggregates into a Stats record.
  snapshot(): Stats {
    return { min: this.min, max: this.max, sum: this.sum, count: this.count };
  }
}

// ---------------------------------------------------------------------------
// Compute Stats over the fixed sample window. `count` is passed explicitly so
// the loop bound is a plain integer compare, robust to the array's lowering.
// ---------------------------------------------------------------------------

function computeStats(count: int32_t): Stats {
  const acc: Accumulator = new Accumulator();
  for (let i: int32_t = 0; i < count; i = i + 1) {
    acc.add(SAMPLES[i]);
  }
  return acc.snapshot();
}

// ---------------------------------------------------------------------------
// Build the multi-line report for a Stats record. Built by STRING
// CONCATENATION with '\n' separators — no growable array storage required,
// which keeps the whole program free of any `std::vector` site on AVR.
// ---------------------------------------------------------------------------

function report(s: Stats): string {
  let line: string = '';
  line = line + 'count: ' + s.count + '\n';
  line = line + 'min:    ' + s.min + '\n';
  line = line + 'max:    ' + s.max + '\n';
  line = line + 'sum:    ' + s.sum + '\n';
  line = line + 'avg:    ' + (s.count > 0 ? s.sum / s.count : 0);
  return line;
}

// ---------------------------------------------------------------------------
// Driver. Compute Stats over the fixed sample window and print the report.
// Runs once; the auto-generated `loop()` stays empty.
//
// The driver is written as `function main()` + a top-level `main()` call. On
// Arduino the top-level call flows into the auto-generated `setup()` and the
// user `main` is renamed to `cuttlefish_main` (Arduino has no `main()` — its
// entrypoints are `setup()`/`loop()`; a file-scope `static void main()` would
// collide with C++'s required `int main()` signature).
// ---------------------------------------------------------------------------

function main(): void {
  console.log('--- sensor statistics demo ---');
  const stats: Stats = computeStats(SAMPLES.length);
  console.log(report(stats));
  console.log('done');
}

main();
