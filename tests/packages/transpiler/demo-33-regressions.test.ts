// ---------------------------------------------------------------------------
// Demo #33 regressions — five transpiler gaps surfaced by the FIRST Arduino AVR
// (arduino:avr:uno) demo, which compiles through avr-gcc (every prior demo
// #1–#32 compiled through native g++). AVR is a genuinely different
// environment: no <vector>/<string>/<iostream>, no exceptions/RTTI, heap
// allocation discouraged, and `int` is 16-bit. All five gaps are now FIXED in
// the transpiler / framework-arduino; this file pins the behavior. The demo
// source (demo/src/main.ts) carries no workarounds and the full `npm run
// compile` against `arduino:avr:uno` succeeds (Flash 14%, RAM 15%).
//
//   A — A user `function main()` collided with C++'s required `int main()`.
//       Arduino has no `main()` (the entrypoints are the auto-generated
//       `setup()`/`loop()`), but the transpiler emitted the user fn as
//       `static void main()` and the top-level `main()` call flowed into
//       `setup()` verbatim → avr-g++ "cannot declare '::main' to be static" /
//       "'::main' must return 'int'". The Arduino strategy's
//       `mapFunctionName('main') → 'cuttlefish_main'` existed but was dead —
//       never applied at emit time. Fix: route every function name through
//       `strategy.mapFunctionName` when building mappedFunctions, and apply
//       the rename at the single call-rendering chokepoint
//       (StatementRenderer.renderCall) so every call site — definition,
//       forward decl, and the top-level call spliced into setup() — follows.
//       `emit/emitters/setup.ts` + `emit/statement-renderer.ts`.
//
//   B — `.length` on a raw C array emitted `.size()`. A non-mutated array
//       literal on a target that does NOT need std::vector
//       (`!strategy.needsStdVector()`, e.g. Arduino AVR) lowers to a RAW C
//       array (`int32_t S[] = {...}`) — the emit-side discriminator
//       (class-emitter.ts `addCArrayIfNotMutable`) uses exactly that test.
//       But `.length` resolution tested only the varType prefix
//       (`std::vector<...>`), so it emitted `S.size()` on a raw C array →
//       avr-g++ "request for member 'size' in 'S', which is of non-class
//       type 'int32_t [12]'". Two sub-cases:
//         • FUNCTION-LOCAL literal (`const a = [1,2,3]`) — the
//           activeArrayLiteralVars branch now mirrors the emit discriminator
//           (`!needsStdVector()` OR promoted-to-StaticArray via
//           mutableArrayVars → container `.size()`; else raw C array →
//           sizeof). `ir/expression-to-ir.ts`.
//         • TOP-LEVEL literal (`const SAMPLES: int32_t[] = [...]`) — not in
//           any function-scoped set (resetFunctionScopeState clears
//           activeArrayLiteralVars before each function), so `.length` fell
//           through to the default `.size()`. The identifier fallthrough now
//           reads `globals` (which persists) and routes a top-level
//           std::vector-typed const array on a no-std::vector target to
//           sizeof. `ir/expression-to-ir.ts`.
//       Native/generic (`needsStdVector()` true) keep `.size()` — a top-level
//       const array really IS a std::vector there.
//
//   C — `__tc_str_ptr` shim was dropped when a string-typed RETURN/FIELD/LOCAL
//       used it. The `usesStrPtr` analysis flag compared the PRE-normalization
//       cppType (`std::string`) against `parseCppType(...).kind === "strPtr"`,
//       which never matched — the Arduino strategy normalizes
//       `std::string → __tc_str_ptr` only at emit time. So the shim block was
//       filtered out and avr-g++ saw `'__tc_str_ptr' does not name a type`.
//       Fix: the declaredTypes post-process loop (the single broadest
//       chokepoint over every declared type) now resolves `std::string`
//       through `strategy.normalizeCppType` and sets `usesStrPtr` when the
//       strategy maps it to `__tc_str_ptr`. `ir/program-analysis.ts`.
//
//   D — Reserved-member-name rename was inconsistent across emit sites. A
//       field named like an Arduino macro (`min`/`max`) was DECLARED `min_`
//       (escapeCppKeyword suffix, used by class-field decls and accesses) but
//       the `assign` statement target used escapeCppKeyword on the COMPOUND
//       string `this.min` (which doesn't match the bare `min`), leaving the
//       assignment as `this->min = ...` while reads were `this->min_` →
//       declaration/access mismatch. And interface/struct field decls used the
//       bare `field.name` (no escape at all), so `struct Stats { int32_t min; }`
//       was accessed as `s.min_`. Fix: a shared `escapeTrailingMember` helper
//       (utils/strings.ts) renames only the trailing member of a compound
//       lvalue, used by the assign-target path; and interface field decls now
//       route through `escapeCppKeyword(field.name, reservedNames)` to match
//       class fields and accesses. `emit/statement-renderer.ts` +
//       `emit/emitters/type-decl-emitter.ts` + `utils/strings.ts`.
//
//   E — `std::vector` storage classes on AVR were silently emitted and failed
//       at avr-g++ time. A class FIELD, function PARAMETER, or RETURN TYPE
//       annotated `T[]` resolves to `std::vector<T>` — which AVR does not have
//       (no <vector>, no heap). The function-local literal path lowers to a
//       fixed-size __tc_StaticArray (the literal supplies N) and is fine, but
//       a field/param/return has no literal at the declaration site to recover
//       a compile-time size, and is dynamically grown in the idiomatic case.
//       Rather than emit `std::vector<T>` and let avr-g++ fail with an opaque
//       "'vector' in namespace 'std' does not name a template type", the
//       framework-arduino strategy's `profileDiagnostics` now emits a clear,
//       source-located `TS2CPP_NO_VECTOR_STORAGE` error for every such site
//       on no-`std::vector` architectures. `framework-arduino/src/strategy.ts`.
//
// All fixes are pinned below. The demo source carries no workarounds.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile, transpileAVR, transpileESP32, transpileNative } from "../../setup";

// ── A: user `main()` → `cuttlefish_main` on Arduino ─────────────────────────

describe("A: user function main() renamed on Arduino", () => {
  it("emits the user main() as cuttlefish_main, never static void main()", () => {
    const src = `
function greet(): void { console.log('hi'); }
function main(): void { greet(); }
main();
`;
    const res = transpileAVR(src);
    expect(res.cpp).toContain("cuttlefish_main");
    // The colliding `static void main()` must never appear.
    expect(res.cpp).not.toMatch(/\bstatic\s+void\s+main\s*\(/);
    expect(res.cpp).not.toMatch(/\bint\s+main\s*\(/);
  });

  it("rewrites the top-level main() call inside setup() to cuttlefish_main()", () => {
    const src = `
function main(): void { console.log('x'); }
main();
`;
    const res = transpileAVR(src);
    // setup() is auto-generated and contains the renamed call.
    expect(res.cpp).toMatch(/void\s+setup\s*\([^)]*\)\s*\{[\s\S]*?cuttlefish_main\(\)/);
  });

  it("does NOT rename main on native (no collision there)", () => {
    const src = `
function main(): void { console.log('x'); }
main();
`;
    const res = transpileNative(src);
    // On native the entrypoint is `main` and a user `function main()` flows
    // into it; cuttlefish_main must not appear.
    expect(res.cpp).not.toContain("cuttlefish_main");
  });

  it("renames a user function that calls main() too (transitive call site)", () => {
    const src = `
function helper(): void { main(); }
function main(): void { console.log('x'); }
helper();
`;
    const res = transpileAVR(src);
    // The call inside helper() must reference the renamed symbol.
    expect(res.cpp).toMatch(/cuttlefish_main\(\)/);
    expect(res.cpp).not.toMatch(/\bstatic\s+void\s+main\s*\(/);
  });
});

// ── B: `.length` on a raw C array (local + top-level) → sizeof ──────────────

describe("B: .length on raw C arrays (AVR) lowers to sizeof", () => {
  it("lowers .length on a function-local non-mutated array literal to sizeof on AVR", () => {
    const src = `
function main(): void {
  const a: int32_t[] = [1, 2, 3];
  console.log('' + a.length);
}
main();
`;
    const res = transpileAVR(src);
    // The local emits as a raw C array; .length must be sizeof, not .size().
    expect(res.cpp).toContain("int32_t a[]");
    expect(res.cpp).toContain("(sizeof(a) / sizeof(a[0]))");
    expect(res.cpp).not.toMatch(/\ba\.size\(\)/);
  });

  it("lowers .length on a top-level const array literal to sizeof on AVR", () => {
    const src = `
const SAMPLES: int32_t[] = [1, 2, 3, 4];
function main(): void {
  console.log('' + SAMPLES.length);
}
main();
`;
    const res = transpileAVR(src);
    expect(res.cpp).toContain("int32_t SAMPLES[]");
    expect(res.cpp).toContain("(sizeof(SAMPLES) / sizeof(SAMPLES[0]))");
    expect(res.cpp).not.toMatch(/\bSAMPLES\.size\(\)/);
  });

  it("keeps .size() for a mutated local (promoted to StaticArray) on AVR", () => {
    const src = `
function main(): void {
  const a: int32_t[] = [];
  a.push(1);
  console.log('' + a.length);
}
main();
`;
    const res = transpileAVR(src);
    // A .push-mutated local promotes to __tc_StaticArray, which has .size().
    expect(res.cpp).toMatch(/__tc_StaticArray/);
    expect(res.cpp).toMatch(/a\.size\(\)/);
  });

  it("keeps .size() on native (real std::vector) for a non-mutated local", () => {
    const src = `
function main(): void {
  const a: int32_t[] = [1, 2, 3];
  console.log('' + a.length);
}
main();
`;
    const res = transpileNative(src);
    // Native emits a real std::vector; .size() is correct, sizeof would be wrong.
    expect(res.cpp).toMatch(/a\.size\(\)/);
    expect(res.cpp).not.toMatch(/sizeof\(a\)/);
  });

  it("keeps .size() on native for a top-level const array (real std::vector)", () => {
    const src = `
const SAMPLES: int32_t[] = [1, 2, 3, 4];
function main(): void {
  console.log('' + SAMPLES.length);
}
main();
`;
    const res = transpileNative(src);
    expect(res.cpp).toMatch(/SAMPLES\.size\(\)/);
    expect(res.cpp).not.toMatch(/sizeof\(SAMPLES\)/);
  });
});

// ── C: `__tc_str_ptr` shim emitted for string returns/fields on Arduino ─────

describe("C: __tc_str_ptr shim emitted when string types are present (Arduino)", () => {
  it("emits the __tc_str_ptr struct when a method returns string", () => {
    const src = `
class Greeter {
  greet(): string { return 'hi'; }
}
function main(): void { console.log(new Greeter().greet()); }
main();
`;
    const res = transpileAVR(src);
    // The report()/greet() return lowers to __tc_str_ptr on Arduino; the shim
    // struct must be present or avr-g++ fails ("'__tc_str_ptr' does not name
    // a type").
    expect(res.cpp).toContain("struct __tc_str_ptr");
  });

  it("emits the __tc_str_ptr struct for a string-typed local in a method", () => {
    const src = `
class Builder {
  build(): string {
    const s: string = 'x';
    return s;
  }
}
function main(): void { console.log(new Builder().build()); }
main();
`;
    const res = transpileAVR(src);
    expect(res.cpp).toContain("struct __tc_str_ptr");
  });
});

// ── D: reserved-member-name rename consistency ──────────────────────────────

describe("D: reserved member name (min/max) renamed consistently", () => {
  it("renames an interface field AND its access to the same escaped name", () => {
    const src = `
interface Stats { min: int32_t; max: int32_t; }
function report(s: Stats): int32_t { return s.min + s.max; }
function main(): void { console.log('' + report({ min: 1, max: 2 })); }
main();
`;
    const res = transpileAVR(src);
    // The struct field and the access must BOTH be `min_` (suffix) — never a
    // mix of `min` / `min_` / `_min`.
    expect(res.cpp).toMatch(/struct\s+Stats\s*\{[\s\S]*?int32_t\s+min_[\s\S]*?int32_t\s+max_/);
    expect(res.cpp).toContain("s.min_");
    expect(res.cpp).toContain("s.max_");
    // The unescaped bare access must not leak.
    expect(res.cpp).not.toMatch(/\bs\.min\b(?!_)/);
  });

  it("renames a class field assignment target consistently with its declaration", () => {
    const src = `
class Acc {
  min: int32_t;
  constructor() { this.min = 0; }
  set(v: int32_t): void { this.min = v; }
  get(): int32_t { return this.min; }
}
function main(): void {
  const a: Acc = new Acc();
  a.set(5);
  console.log('' + a.get());
}
main();
`;
    const res = transpileAVR(src);
    // Declaration, assignment target, and read must all be `min_`.
    expect(res.cpp).toMatch(/int32_t\s+min_/);
    expect(res.cpp).toContain("this->min_ = 0");
    expect(res.cpp).toContain("this->min_ = v");
    expect(res.cpp).toContain("return this->min_");
    // The unescaped `this->min` (without trailing _) must not appear.
    expect(res.cpp).not.toMatch(/this->min(?![A-Za-z0-9_])/);
  });
});

// ── E: TS2CPP_NO_VECTOR_STORAGE diagnostic on AVR ───────────────────────────

describe("E: std::vector storage rejected on no-vector architectures (AVR)", () => {
  it("flags a class field with an array type on AVR", () => {
    const src = `
class Buf {
  data: int32_t[];
  constructor() { this.data = []; }
}
function main(): void { const b = new Buf(); }
main();
`;
    const res = transpileAVR(src);
    const errs = res.diagnostics.filter(d => d.code === "TS2CPP_NO_VECTOR_STORAGE");
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].message).toContain("Buf.data");
    expect(errs[0].hint).toMatch(/function-local|Map/i);
  });

  it("flags a function parameter with an array type on AVR", () => {
    const src = `
function sum(vals: int32_t[]): int32_t { return vals[0]; }
function main(): void { console.log('' + sum([1])); }
main();
`;
    const res = transpileAVR(src);
    const errs = res.diagnostics.filter(d => d.code === "TS2CPP_NO_VECTOR_STORAGE");
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].message).toContain("sum(vals)");
  });

  it("flags a function return type with an array type on AVR", () => {
    const src = `
function make(): int32_t[] { return [1, 2, 3]; }
function main(): void { console.log('' + make().length); }
main();
`;
    const res = transpileAVR(src);
    const errs = res.diagnostics.filter(d => d.code === "TS2CPP_NO_VECTOR_STORAGE");
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].message).toContain("make");
  });

  it("does NOT flag array fields/params/returns on native (std::vector available)", () => {
    const src = `
class Buf { data: int32_t[]; }
function sum(vals: int32_t[]): int32_t { return vals[0]; }
function make(): int32_t[] { return [1, 2, 3]; }
function main(): void { console.log('' + sum(make())); }
main();
`;
    const res = transpileNative(src);
    const errs = res.diagnostics.filter(d => d.code === "TS2CPP_NO_VECTOR_STORAGE");
    expect(errs).toEqual([]);
  });

  it("does NOT flag a function-local array literal on AVR (promotes to StaticArray)", () => {
    // A function-local literal is the SUPPORTED AVR idiom — it must NOT trip
    // the gate.
    const src = `
function main(): void {
  const a: int32_t[] = [1, 2, 3];
  console.log('' + a[0]);
}
main();
`;
    const res = transpileAVR(src);
    const errs = res.diagnostics.filter(d => d.code === "TS2CPP_NO_VECTOR_STORAGE");
    expect(errs).toEqual([]);
  });
});
