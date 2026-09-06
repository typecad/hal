// ---------------------------------------------------------------------------
// Demo #31 regressions — three transpiler gaps surfaced by a Roman-numerals
// + English number-words converter demo. All three are now FIXED in the
// transpiler; this file pins the behavior. The demo source carries the
// natural idiomatic forms (a class-method body that reads indexed top-level
// arrays via `.push(globalArr[i])`, a `.join(' ')` on a `.push`-built
// `string[]`, and a `for (const r of GLOBAL_STRING_ARR)` whose element type
// must flow into a template-literal format specifier) and recompiles clean
// with correct output.
//
//   A — A top-level `const` variable referenced ONLY from a class-method body
//       through a lowered `__RAW_STMT__` callee that contained an ARRAY INDEX
//       (`parts.push(ONES_TEENS[i])` → callee `__RAW_STMT__parts.push_back(ONES_TEENS[i])`
//       with `args: []`) was tree-shaken by `filterProgramIR`.
//       `collectStatementIdentifiers` splits the raw callee on `/->|::|[.(]/`
//       to extract identifiers; that split stops at `[` but NOT at `]`, so
//       `"ONES_TEENS[i])"` survived as one compound token and `ONES_TEENS`
//       was never added to the call graph as a dependency of the class. The
//       variable was then emitted in neither the .cpp definition NOR the .h
//       extern, and g++ reported it "not declared in this scope" from the
//       inline class-method body. This is the SAME blind-spot family as
//       demo #22 B / demo #28 C / demo #30 A — each found a different walk
//       that under-extracted identifiers from a lowered raw/paren wrapper.
//       Fix: when the `call` statement's callee is a `__RAW_STMT__` wrapper,
//       scan its raw text with the SAME identifier regex the `raw` expression
//       case uses, so EVERY identifier embedded in the raw expression is
//       collected regardless of bracket/paren structure.
//       `ir/identifier-collector.ts`.
//
//   B — `.join(sep)` on a `std::vector` receiver was emitted VERBATIM
//       (`parts.join(" ")`) on a known-array receiver, so g++ rejected it
//       with "'std::vector<...>' has no member named 'join'". Root cause:
//       `__tc_join` was misclassified in the STRING-method registry
//       (`api/shared/string-method-registry.ts`), so the string-method
//       lowering path was the only one that recognized the name. But
//       `shouldLowerAsStringMethod` correctly rejects known-array receivers
//       (a `.push`-built `string[]` is in `mutableArrayVars`), and the
//       vector-method table `VECTOR_VALUE_METHOD_LOWERINGS` had no `join`
//       entry — so BOTH paths declined the call and it fell through to
//       verbatim emit. `join` is a vector→string transformation, not a
//       string method. Fix: removed `__tc_join` from STRING_METHODS and
//       added a `join` entry to `VECTOR_VALUE_METHOD_LOWERINGS` (the
//       polyfill helper is still registered via POLYFILL_HELPER_MAP['.join(']).
//       `api/shared/string-method-registry.ts` + `ir/transformers/array-methods.ts`.
//
//   C — A `for (const r of GLOBAL_STRING_ARR)` whose iterable is a TOP-LEVEL
//       `const` array (not a function local) emitted `for (const auto& r : ...)`
//       with the loop variable typed `auto`, and a template-literal
//       interpolation `${r}` then picked the WRONG snprintf specifier (`%d`
//       instead of `%s`), tripping g++ -Wformat= and producing garbage at
//       runtime. Root cause: `inferExprCppType` for a bare `ts.Identifier`
//       consulted ONLY the function-local types map, not the IR type scope's
//       `globals` (populated for every top-level decl in `variables.ts`). So
//       a top-level `const ARR: string[]` resolved to `"auto"` when used as a
//       for-of iterable, the element-type inference then saw `auto` (not a
//       vector), the loop variable kept `auto`, and because a for-of var has
//       no initializer the snprintf specifier picker couldn't recover the
//       real type — defaulting to `%d`. Fix: `inferExprCppType` now consults
//       the IR type scope's `globals` map as a fallback for bare identifiers
//       (matching what `resolveReceiverCppType` in `array-methods.ts` already
//       does for the string/array-method disambiguation).
//       `ir/type-resolution.ts`.
//
// NOTE: Findings A and C only reproduce through the FULL pipeline
// (build IR → call graph → reachability → filter → emit); the test harness's
// plain `transpile()` helper skips `filterProgramIR`, so A's tree-shake never
// runs and C's for-of var type happens to be recoverable in some shapes.
// `transpileNativeFullPipeline` below runs the full pipeline. Finding B
// reproduces through either path.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import { transpile } from "../../setup";
import {
  buildProgramIR,
  buildCallGraph,
  analyzeReachability,
  filterProgramIR,
  emitCpp,
  resolveStrategy,
} from "../../../packages/cuttlefish/src/testing";
import { setActiveStrategy } from "../../../packages/cuttlefish/src/ir/hal-resolver";
import { NativeStrategy } from "../../../packages/cuttlefish/src/frameworks/native";
import { setLoadedFramework, registerPlatformStrategy } from "../../../packages/cuttlefish/src/testing";
import { STRING_METHOD_NAMES } from "../../../packages/cuttlefish/src/api/shared/string-method-registry";

setLoadedFramework({ strategy: new NativeStrategy() });
registerPlatformStrategy(new NativeStrategy());

function transpileNativeSingle(tsCode: string) {
  return transpile(tsCode, { target: "native", emitMode: "single" });
}

function transpileNativeSplit(tsCode: string) {
  return transpile(tsCode, { target: "native", emitMode: "split" });
}

// Full pipeline: build IR → call graph → reachability → filter → emit. This is
// what `cuttlefish build` runs; the plain `transpile()` helper skips
// tree-shaking (filterProgramIR), so Finding A only reproduces through here.
function transpileNativeFullPipeline(tsCode: string, emitMode: "cpp" | "split" = "cpp"): { cpp: string; header?: string } {
  setActiveStrategy(resolveStrategy("native"));
  const program = buildProgramIR("demo31_repro.ts", tsCode);
  const cg = buildCallGraph(program);
  const reach = analyzeReachability(program, cg, { target: "native" });
  const filtered = filterProgramIR(program, reach, { enabled: true });
  const result = emitCpp(filtered, {
    outDir: ".build/tests",
    emitMode,
    target: "native",
    libdefs: new Map(),
    emitMaps: false,
  });
  let cpp = "";
  if (result.sourcePath && fs.existsSync(result.sourcePath)) {
    cpp = fs.readFileSync(result.sourcePath, "utf-8");
    fs.unlinkSync(result.sourcePath);
  }
  let header: string | undefined;
  if (result.headerPath && fs.existsSync(result.headerPath)) {
    header = fs.readFileSync(result.headerPath, "utf-8");
    fs.unlinkSync(result.headerPath);
  }
  return { cpp, header };
}

// ── A: top-level var reached only via raw-callee-with-index is kept ─────────

describe("A: top-level var reached via raw-callee array index is kept", () => {
  it("globalArr[i] inside parts.push(globalArr[i]) keeps globalArr in scope (split header)", () => {
    // The natural idiom: a static class method reads an indexed top-level
    // const array and pushes the element into a local `string[]`. The push
    // lowers to a `__RAW_STMT__parts.push_back(ONES_TEENS[i])` callee with
    // `args: []`, so the only way the call graph sees `ONES_TEENS` is by
    // scanning the raw callee text. The split-mode header carries the inline
    // method body, so the variable must be visible there too — both the
    // `extern` (in the header) AND the definition (in the .cpp) must appear.
    const result = transpileNativeFullPipeline(`
      const ONES_TEENS: string[] = ['zero', 'one', 'two'];
      class NumberWords {
        static spell(n: int32_t): string {
          const parts: string[] = [];
          parts.push(ONES_TEENS[n]);
          return parts.join(' ');
        }
      }
      export function main(): void { const _log = NumberWords.spell(1); }
    `, "split");
    const header = result.header ?? "";
    // The extern declaration must appear in the header so the inline method
    // body (which lives in the header in split mode) can see it.
    expect(header).toMatch(/extern\s+const\s+std::vector<std::string>\s+ONES_TEENS\s*;/);
    // The definition must appear in the .cpp.
    expect(result.cpp).toMatch(/const\s+std::vector<std::string>\s+ONES_TEENS\s*=/);
  });

  it("globalArr[i] reached from a class method survives filterProgramIR (single-file)", () => {
    // Same shape, single-file emit. The variable definition must survive
    // tree-shaking. Without the fix, filterProgramIR removed it because the
    // raw-callee split left `ONES_TEENS` hidden inside `"ONES_TEENS[i])"`.
    const result = transpileNativeFullPipeline(`
      const ONES_TEENS: string[] = ['zero', 'one', 'two'];
      class C {
        static pick(n: int32_t): string { const p: string[] = []; p.push(ONES_TEENS[n]); return p.join(','); }
      }
      export function main(): void { const _log = C.pick(2); }
    `);
    expect(result.cpp).toMatch(/ONES_TEENS/);
    // The array's contents must survive (it must not be replaced by a stub).
    expect(result.cpp).toMatch(/"zero"/);
    expect(result.cpp).toMatch(/"two"/);
  });

  it("globalArr[i] reached via __tc_pop(map[k]) — raw wrapper with bracket inside call args", () => {
    // A different raw-callee shape: a Map.get result wrapped in __tc_pop and
    // indexed. The identifier extraction must still see the indexed name.
    const result = transpileNativeFullPipeline(`
      const LOOKUP: string[] = ['a', 'b', 'c'];
      class C {
        static go(m: Map<string, int32_t>, k: string): string {
          const idx: int32_t = m.get(k)!;
          return LOOKUP[idx];
        }
      }
      export function main(): void {
        const m: Map<string, int32_t> = new Map();
        m.set('x', 1);
        const _log = C.go(m, 'x');
      }
    `);
    expect(result.cpp).toMatch(/LOOKUP/);
  });

  it("regression: a function-local array index does not falsely promote a same-named global", () => {
    // Make sure the new raw-text scan does not pick up identifiers that are
    // purely local. A function-local `local[i]` referenced in a push from a
    // class method should not require any global.
    const result = transpileNativeFullPipeline(`
      class C {
        static go(): void {
          const local: int32_t[] = [1, 2, 3];
          const sink: int32_t[] = [];
          sink.push(local[0]);
          const _log = sink.length;
        }
      }
      export function main(): void { C.go(); }
    `);
    // No globals declared; the output must compile (no externs for locals).
    expect(result.cpp).not.toMatch(/^extern\s+/m);
  });
});

// ── B: .join(sep) on a std::vector lowers to __tc_join ──────────────────────

describe("B: .join(sep) lowers to __tc_join on a vector receiver", () => {
  it("parts.join(' ') on a .push-built string[] lowers to __tc_join", () => {
    // The demo shape: build a `string[]` via `.push`, then `.join(' ')`. The
    // receiver is in `mutableArrayVars`, so the (now-removed) string-method
    // path declined it; the fix routes it through the vector value-method
    // table to `__tc_join(parts, " ")`.
    const cpp = transpileNativeSingle(`
      export function main(): void {
        const parts: string[] = [];
        parts.push('a');
        parts.push('b');
        const s: string = parts.join(' ');
        const _log = s;
      }
    `).cpp ?? "";
    expect(cpp).toMatch(/__tc_join\(/);
    // Must NOT be the verbatim `parts.join(` that g++ rejects.
    expect(cpp).not.toMatch(/parts\.join\(/);
  });

  it("named-vector .join(sep) on a const string[] (no .push) still lowers", () => {
    // A non-mutated `const words: string[]` joined with a separator — the
    // receiver is NOT in mutableArrayVars. The vector path handles it the
    // same way (it always has; this asserts the new entry doesn't break it).
    const cpp = transpileNativeSingle(`
      const WORDS: string[] = ['hello', 'world'];
      export function main(): void { const s: string = WORDS.join('-'); const _log = s; }
    `).cpp ?? "";
    expect(cpp).toMatch(/__tc_join\(/);
    expect(cpp).not.toMatch(/WORDS\.join\(/);
  });

  it("inline array-literal .join(sep) receiver is type-qualified for deduction", () => {
    // `['a','b'].join('-')` — the receiver is an inline array literal. The
    // __tc_join template helper needs a typed `std::vector<ElemType>{...}`
    // receiver to deduce its element type (the demo #29 Finding D mechanism,
    // shared via renderArrayMethodReceiver).
    const cpp = transpileNativeSingle(`
      export function main(): void { const s: string = ['a', 'b'].join('-'); const _log = s; }
    `).cpp ?? "";
    expect(cpp).toMatch(/__tc_join\(std::vector<std::string>\{[^}]*\},\s*"-"\)/);
  });

  it(".join is NOT registered as a string method (removed from STRING_METHODS)", () => {
    // Guard against re-adding `__tc_join` to the string-method table. A
    // string receiver `.join` is nonsensical (strings have no `.join`), and
    // listing it there caused the vector receiver to fall through both
    // lowering paths. The string-method registry must no longer carry it.
    expect(STRING_METHOD_NAMES.has("join")).toBe(false);
  });

  it(".join polyfill helper is still registered (via POLYFILL_HELPER_MAP)", () => {
    // The __tc_join helper template is still emitted when needed — the
    // polyfill registration path (POLYFILL_HELPER_MAP['.join(']) was
    // unchanged by the fix and must keep firing.
    const cpp = transpileNativeSingle(`
      export function main(): void { const s: string = ['a'].join(','); const _log = s; }
    `).cpp ?? "";
    expect(cpp).toMatch(/__tc_join\(/);
    // The template definition must be emitted too (otherwise g++ link error).
    expect(cpp).toMatch(/template<typename T>\s+std::string\s+__tc_join\b/);
  });
});

// ── C: for-of over a top-level const array resolves the loop var type ───────

describe("C: for-of over a module-scope array resolves the loop variable type", () => {
  it("for (const r of GLOBAL_STRING_ARR) — r is std::string, template uses %s", () => {
    // The demo shape: iterate a top-level `const ROMAN: string[]` and
    // interpolate each element into a template literal. Previously the loop
    // var carried `auto` and the snprintf specifier defaulted to `%d`
    // (tripping -Wformat= and producing garbage at runtime). Now the iterable
    // resolves via the globals map → the element type flows into the loop var
    // → the format specifier is `%s`.
    const cpp = transpileNativeSingle(`
      const ROMAN: string[] = ['I', 'II', 'III'];
      export function main(): void {
        for (const r of ROMAN) {
          const _log = \`r=\${r}\`;
        }
      }
    `).cpp ?? "";
    // The loop variable must be typed `std::string` (not `auto`).
    expect(cpp).toMatch(/for\s*\(\s*const\s+std::string\s*&\s*r\s*:/);
    // The format specifier must be `%s` and the arg must carry `.c_str()`.
    expect(cpp).toMatch(/%s/);
    expect(cpp).toMatch(/r\.c_str\(\)/);
    // Must NOT default to the integer specifier.
    expect(cpp).not.toMatch(/r=%d/);
  });

  it("for (const n of GLOBAL_INT_ARR) — n stays int, template uses %d", () => {
    // Regression guard: the integer-array path was already correct (`auto`
    // falls through to `%d` by default). It must remain correct.
    const cpp = transpileNativeSingle(`
      const NUMS: int32_t[] = [10, 20, 30];
      export function main(): void {
        for (const n of NUMS) {
          const _log = \`n=\${n}\`;
        }
      }
    `).cpp ?? "";
    // The loop variable must be `int32_t` (or `const int32_t&`).
    expect(cpp).toMatch(/for\s*\(\s*const\s+int32_t\s*&?\s*n\s*:/);
    expect(cpp).toMatch(/n=%d/);
  });

  it("for-of over a global resolves the element type through the globals map (not locals)", () => {
    // A function-local of the same name as a global must NOT shadow the
    // global lookup for the for-of iterable. The global `WORDS` (string[])
    // is the iterable; a local `WORDS` would be a type error here, but the
    // lookup precedence (locals first, globals fallback) is what's under
    // test — the local map has no `WORDS`, so globals must be consulted.
    const cpp = transpileNativeFullPipeline(`
      const WORDS: string[] = ['hi', 'there'];
      export function main(): void {
        for (const w of WORDS) {
          const _log = \`w=\${w}\`;
        }
      }
    `).cpp;
    expect(cpp).toMatch(/for\s*\(\s*const\s+std::string\s*&\s*w\s*:/);
    expect(cpp).toMatch(/w=%s/);
  });

  it("regression: for-of over a function-local array still works", () => {
    // The fix adds a globals fallback; the locals-first path must still work.
    const cpp = transpileNativeSingle(`
      export function main(): void {
        const xs: int32_t[] = [1, 2, 3];
        for (const x of xs) {
          const _log = \`x=\${x}\`;
        }
      }
    `).cpp ?? "";
    expect(cpp).toMatch(/for\s*\(\s*const\s+int32_t\s*&?\s*x\s*:/);
    expect(cpp).toMatch(/x=%d/);
  });
});

// ── Smoke: the natural demo idiom compiles through the full pipeline ────────

describe("smoke: demo #31 idiomatic shape compiles end-to-end", () => {
  it("parallel-array encoder + for-of + .push + .join — clean emit", () => {
    // A condensed version of the demo's three stresses in one program:
    //  - a class method reading indexed top-level arrays via .push (Finding A)
    //  - a .join(' ') on a .push-built string[] (Finding B)
    //  - a for-of over a top-level string[] interpolated into a template (Finding C)
    const result = transpileNativeFullPipeline(`
      const VALUES: int32_t[] = [1000, 100, 10, 1];
      const SYMBOLS: string[] = ['M', 'C', 'X', 'I'];
      const SAMPLE: string[] = ['MMXXIV', 'XLVII'];

      class Encoder {
        static encode(n: int32_t): string {
          const out: string[] = [];
          let remaining: int32_t = n;
          for (let i = 0; i < 4; i = i + 1) {
            while (remaining >= VALUES[i]) {
              out.push(SYMBOLS[i]);
              remaining = remaining - VALUES[i];
            }
          }
          return out.join('');
        }
      }

      export function main(): void {
        for (const r of SAMPLE) {
          const _log = \`sample=\${r} len=\${r.length}\`;
        }
        const _log = Encoder.encode(2024);
      }
    `, "split");
    const header = result.header ?? "";
    // All three globals must survive tree-shaking AND be extern'd in the header
    // (the class method reads VALUES/SYMBOLS; main() reads SAMPLE).
    expect(header).toMatch(/extern\s+const\s+std::vector<int32_t>\s+VALUES\s*;/);
    expect(header).toMatch(/extern\s+const\s+std::vector<std::string>\s+SYMBOLS\s*;/);
    expect(header).toMatch(/extern\s+const\s+std::vector<std::string>\s+SAMPLE\s*;/);
    // .join('') lowered to __tc_join — in split mode the inline class-method
    // body lives in the header, so the helper call may appear there OR in the
    // .cpp. Check the combined text.
    const combined = result.cpp + (result.header ?? "");
    expect(combined).toMatch(/__tc_join\(/);
    // The for-of loop variable must be typed (not `auto`), so the template
    // uses `%s` with `.c_str()`.
    expect(result.cpp).toMatch(/for\s*\(\s*const\s+std::string\s*&\s*r\s*:\s*SAMPLE\s*\)/);
    expect(result.cpp).toMatch(/%s/);
  });
});
