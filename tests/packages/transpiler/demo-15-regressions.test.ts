// ---------------------------------------------------------------------------
// Demo #15 regressions — Map/Set iteration, const-correct Map.get, and the
// ownership-suggest-const / const-collection-mutation contradiction.
//
// Fixes pinned here:
//   A — Map.values()/keys()/entries() (and Set.values/keys/entries) lower to
//       __tc_mapValues / __tc_mapKeys / __tc_mapEntries / __tc_setValues /
//       __tc_setEntries runtime helpers, so a for...of iterates the VALUES
//       (not the raw std::pair entries of the underlying std::map).
//   B — Map.get(k) lowers to const-correct m.at(k) instead of operator[]
//       (non-const, fails on a const-bound Map, silently inserts on miss).
//   C — const-bound Map/Set mutated via .set()/.add()/.delete() are demoted
//       to non-const, AND ownership-suggest-const no longer fires for a
//       collection mutated via a method (the contradiction is resolved).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile, findDiagnostics } from "../../setup";

function transpileNative(tsCode: string) {
  return transpile(tsCode, { target: "native", emitMode: "cpp" });
}

// ── A: Map.values() / .keys() / .entries() ──────────────────────────────────

describe("A: Map.values()/keys()/entries() lower to value-iteration helpers", () => {
  it("Map.values() lowers to __tc_mapValues and the loop iterates values", () => {
    const result = transpileNative(`
      let m: Map<string, int32_t> = new Map();
      m.set('a', 1);
      m.set('b', 2);
      let sum: int32_t = 0;
      for (const v of m.values()) { sum += v; }
      console.log(sum);
    `);
    expect(result.cpp).toContain("__tc_mapValues(");
    // The loop must iterate the helper's return, NOT the bare map.
    expect(result.cpp).toMatch(/for \(const auto& v : __tc_mapValues\(m\)\)/);
    // And must NOT iterate the raw map (the old broken lowering).
    expect(result.cpp).not.toMatch(/for \(const auto& v : m\)/);
  });

  it("Map.keys() lowers to __tc_mapKeys", () => {
    const result = transpileNative(`
      let m: Map<string, int32_t> = new Map();
      m.set('a', 1);
      for (const k of m.keys()) { console.log(k); }
    `);
    expect(result.cpp).toContain("__tc_mapKeys(");
    expect(result.cpp).toMatch(/for \(const auto& k : __tc_mapKeys\(m\)\)/);
  });

  it("Map.entries() lowers to __tc_mapEntries", () => {
    const result = transpileNative(`
      let m: Map<string, int32_t> = new Map();
      m.set('a', 1);
      for (const e of m.entries()) { console.log(e); }
    `);
    expect(result.cpp).toContain("__tc_mapEntries(");
    expect(result.cpp).toMatch(/for \(const auto& e : __tc_mapEntries\(m\)\)/);
  });

  it("Set.values() lowers to __tc_setValues", () => {
    const result = transpileNative(`
      let s: Set<int32_t> = new Set();
      s.add(1);
      s.add(2);
      let n: int32_t = 0;
      for (const v of s.values()) { n += v; }
      console.log(n);
    `);
    expect(result.cpp).toContain("__tc_setValues(");
    expect(result.cpp).toMatch(/for \(const auto& v : __tc_setValues\(s\)\)/);
  });

  it("the bare-receiver short-circuit is gone (no raw map range-for)", () => {
    // Regression guard: the old code dropped .values() entirely and emitted
    // `for (... : m)`. Ensure that broken form never returns.
    const result = transpileNative(`
      let m: Map<string, int32_t> = new Map();
      for (const v of m.values()) { console.log(v); }
    `);
    expect(result.cpp).not.toMatch(/for \(const auto& v : m\)/);
    expect(result.cpp).toContain("__tc_mapValues(m)");
  });
});

// ── B: Map.get() lowers to const-correct .at() ──────────────────────────────

describe("B: Map.get() lowers to const-correct .at()", () => {
  it("m.get(k) emits m.at(k) (const-correct lookup)", () => {
    const result = transpileNative(`
      let m: Map<string, int32_t> = new Map();
      m.set('a', 7);
      const v: int32_t = m.get('a')!;
      console.log(v);
    `);
    // The .get() read lowers to .at() — NOT operator[] (which is non-const).
    expect(result.cpp).toContain("m.at(\"a\")");
  });

  it("a read-only const Map accessed via .get() is NOT demoted (distinct names)", () => {
    // A const-bound map that is only read (no .set) must stay const AND compile.
    // .at() has a const overload, so this is valid C++; operator[] would not be.
    // (Uses distinct names per scope: the const analyzer currently keys by
    //  variable name across the whole file, so a shared name would collide.)
    const result = transpileNative(`
      function build(): Map<string, int32_t> {
        let src: Map<string, int32_t> = new Map();
        src.set('a', 7);
        return src;
      }
      function main(): void {
        const catalog: Map<string, int32_t> = build();
        const v: int32_t = catalog.get('a')!;
        console.log(v);
      }
      main();
    `);
    // const catalog stays const (no mutation → no demotion info emitted)...
    expect(result.cpp).toContain("const std::map<std::string, int32_t> catalog =");
    // ...and the read is const-correct .at().
    expect(result.cpp).toContain("catalog.at(\"a\")");
    const demoted = findDiagnostics(result, "ownership-const-content-mutated");
    expect(demoted.length).toBe(0);
  });
});

// ── C: const-collection mutation demotion + suggest-const contradiction ─────

describe("C: const Map/Set mutation demotion and the suggest-const fix", () => {
  it("a const Set mutated via .add() is demoted to non-const", () => {
    const result = transpileNative(`
      function main(): void {
        const s: Set<int32_t> = new Set();
        s.add(1);
        s.add(2);
        console.log(s.has(1));
      }
      main();
    `);
    // The .add() lowers to .insert(); the const Set is demoted (info diagnostic).
    expect(result.cpp).toContain("s.insert(");
    const demoted = findDiagnostics(result, "ownership-const-content-mutated");
    expect(demoted.length).toBeGreaterThanOrEqual(1);
    expect(demoted.some(d => /'s'.*\.insert\(\)/.test(d.message))).toBe(true);
  });

  it("a const Map mutated via .delete() is demoted (erase recognized as a mutator)", () => {
    const result = transpileNative(`
      function main(): void {
        const m: Map<string, int32_t> = new Map();
        m.delete('a');
        console.log('done');
      }
      main();
    `);
    expect(result.cpp).toContain("m.erase(");
    const demoted = findDiagnostics(result, "ownership-const-content-mutated");
    expect(demoted.length).toBeGreaterThanOrEqual(1);
  });

  it("a let Map mutated via .set() does NOT trigger ownership-suggest-const", () => {
    // The contradiction: before the fix, `let m` mutated via .set() (which
    // lowers to m[k]=v) was flagged as "never reassigned → use const", but
    // making it const would fail g++. Now index-assignment marks the let var
    // as effectively reassigned.
    const result = transpileNative(`
      function main(): void {
        let m: Map<string, int32_t> = new Map();
        m.set('a', 1);
        console.log(m.get('a')!);
      }
      main();
    `);
    const suggest = findDiagnostics(result, "ownership-suggest-const");
    const aboutM = suggest.filter(d => /'m' is never reassigned/.test(d.message));
    expect(aboutM.length).toBe(0);
  });

  it("a let Set mutated via .add() does NOT trigger ownership-suggest-const", () => {
    const result = transpileNative(`
      function main(): void {
        let s: Set<int32_t> = new Set();
        s.add(1);
        s.add(2);
        console.log(s.size);
      }
      main();
    `);
    const suggest = findDiagnostics(result, "ownership-suggest-const");
    const aboutS = suggest.filter(d => /'s' is never reassigned/.test(d.message));
    expect(aboutS.length).toBe(0);
  });
});

// ── D: no regression — Object.values(map) still works ────────────────────────

describe("no regression: Object.values/keys/entries(map) unchanged", () => {
  it("Object.values(map) still lowers to __tc_mapValues", () => {
    const result = transpileNative(`
      let m: Map<string, int32_t> = new Map();
      m.set('a', 1);
      const vs: int32_t[] = Object.values(m);
      console.log(vs[0]!);
    `);
    expect(result.cpp).toContain("__tc_mapValues(");
  });
});
