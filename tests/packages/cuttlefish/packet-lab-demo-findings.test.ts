// ---------------------------------------------------------------------------
// Regression tests — transpiler fixes surfaced by the zephyr-packet-lab demo
// (a byte-framing lab: sensor records serialized with FLAG/ESC stuffing +
// CRC-8, reparsed by a state machine, per-channel tallies in a Map, a sorted
// leaderboard, a hex dump, and a recursive-descent expression evaluator).
//
// FIXED here:
//   1. makeSourceSpan fileName/sourceText swap — destructured-parameter
//     extraction statements carried the WHOLE SOURCE TEXT as their
//     SourceSpan.filePath; in gdb-linemarker mode formatLinemarker spewed it
//     verbatim into the emitted C++ (one giant corrupt `# N "..."` marker).
//     makeSourceSpan now refuses newline-bearing file paths at the boundary.
//   2. Vector callback methods on Zephyr — sort(fn)/map/filter/reduce/find/
//     findIndex/every/some had IR lowerings and a gate that REJECTED them
//     ("no lowering on this target") because the gate's hand-copied method
//     list omitted every callback method while the tables happily lowered
//     them (detection/emitter drift). The Zephyr vector_methods polyfill now
//     defines the helpers, and both the decline gate and the vector dispatch
//     derive their method sets from the actual lowering tables.
//   3. Returned closures — the callback hoister promoted ANY lambda to a
//     free function, stranding captures ("'k' was not declared" for
//     `return (x) => x * k`). A lambda referencing anything beyond its own
//     params/locals and program-level symbols stays inline (renderLambda's
//     [&] capture preserves it).
//   4. std::function emitted without <functional>.
//   5. Inline type-literal PARAMETER annotations (`limit: { take: number }`)
//     resolved "auto" → normalizeTypeHintForUse collapsed it to double while
//     the body kept `limit.take`. They now synthesize a named struct (the
//     parameter twin of the _<fn>_ret_t return synthesis).
//   6. Array-of-records promotion emitted the synthesized `_name_t` struct
//     as an EXECUTABLE (inside main) while the declaration it names went to
//     file scope / the split header — "'_sensors_t' was not declared". The
//     struct definitions are hoisted to the declaration phase (header, before
//     the externs, in split mode).
//   7. Function-valued record fields (`read: (): number => …`) inferred as
//     int members; now std::function<R(P...)> (both inference sites).
//   8. Multi-argument .push(a, b) emitted a two-argument push_back. Now a
//     comma-expression sequence keeping the new-length return contract; the
//     promotion path's own seed pushes use push_back (they rendered verbatim
//     as `.push` on the std::vector they themselves declared).
//   9. A const bound to a string element (`const op = s[i]; op === '+'`)
//     compared via strcmp against a literal rendered ("+").c_str() — string
//     element access now infers char and the char-vs-literal comparison
//     recognizes char-typed identifiers.
//  10. Object-literal arguments into mutable-ref record parameters (the
//     param-mutation demotion) cannot bind to T& — they are hoisted into
//     named temporaries at the call site.
//  11. Labeled continue: `continue outer` from an inner loop lowered to a
//     plain continue (continues the INNER loop — silent wrong-code). Now
//     goto __continue_<label> with the target label placed after an inner
//     block holding the body's declarations (a forward goto over
//     initializations is ill-formed), and the machine labels are PLAIN —
//     __attribute__((unused)) on a label is GNU C; g++ never registered the
//     label at all ("used but not defined").
//  12. A ternary with string arms inside a template literal took the %d
//     snprintf default on both snprintf builders (renderer + HAL message
//     ladder) — -Wformat= mismatches; now decided from the branches.
//  13. Math.max(...vals) — the variadic fold mapped arguments individually
//     and a bare SpreadElement has no expression handler (placeholder).
//     Now folds the vector through __tc_max_vec/__tc_min_vec (polyfills on
//     both targets). The HAL-candidate pre-scan no longer trips the
//     placeholder either.
//
// DOCUMENTED-OPEN (repros below, it.fails pins them):
//   A. The IR prescan's array bookkeeping (mutableArrayVars /
//      unboundedArrayVars / arrayPushCounts) is NAME-KEYED and program-global:
//      a `rows` array pushed in a loop in one function poisons a same-named
//      parameter in another (`[...rows]` infers vector<int> and drops the
//      spread). The node-keyed SemanticFacts design exists for the
//      type-checker; the IR prescans predate it.
//   B. A block-bodied comparator with control flow (`(a, b) => { if … }`)
//      declines the __tc_sort_fn lowering — the receiver's scope type is
//      missing in the pass that wins. Expression-bodied comparators lower.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";
import { ZephyrStrategy } from "../../../packages/framework-zephyr/src/strategy";

const zephyr = () => new ZephyrStrategy();
const noErr = (out: { diagnostics: { severity: string }[] }) =>
  out.diagnostics.filter(d => d.severity === "error");

describe("packet-lab demo findings (Zephyr)", () => {
  it("a destructuring parameter never leaks source text into its span filePath", () => {
    const out = transpile(`
      type Row = { mean: number; spread: number };
      function norm({ mean, spread }: Row): number {
        return mean + spread;
      }
      let n = norm({ mean: 1, spread: 2 });
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(noErr(out)).toHaveLength(0);
    // No emitted line may embed the program text (the linemarker corruption
    // class: a multi-line "# N "<source text>"" marker).
    for (const line of out.cpp.split("\n")) {
      if (line.startsWith("# ")) {
        expect(line).toMatch(/^# \d+ "[^"]*"$/);
      }
    }
    expect(out.cpp).toMatch(/double norm\(const Row& __param_0\)/);
  });

  it("callback array methods on a vector receiver lower to the __tc_* helpers", () => {
    const out = transpile(`
      type Row = { label: string; mean: number };
      function top(rows: Row[]): string {
        const copy = [...rows];
        copy.sort((a: Row, b: Row): number => a.mean - b.mean);
        const hot = copy.filter((r: Row): boolean => r.mean > 1);
        const any = copy.some((r: Row): boolean => r.mean > 2);
        return hot.length + (any ? 1 : 0);
      }
      let s = top([{ label: 'a', mean: 1 }]);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(noErr(out)).toHaveLength(0);
    expect(out.cpp).toMatch(/__tc_sort_fn\(copy/);
    expect(out.cpp).toMatch(/__tc_some\(copy/);
    // …and the Zephyr polyfill actually defines them.
    expect(out.cpp).toMatch(/void __tc_sort_fn\(/);
    expect(out.cpp).toMatch(/bool __tc_some\(/);
  });

  it("a returned closure that captures a parameter stays inline", () => {
    const out = transpile(`
      function makeScale(k: number): (x: number) => number {
        return (x: number): number => x * k;
      }
      const f = makeScale(2);
      let n = f(3);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(noErr(out)).toHaveLength(0);
    expect(out.cpp).not.toMatch(/main_isr_/);           // not hoisted
    expect(out.cpp).toMatch(/return \[&\]\(double x\) -> double \{ return x \* k; \};/);
    expect(out.cpp).toContain("#include <functional>"); // std::function ships its header
  });

  it("a non-capturing callback still hoists (ISR globals remain free functions)", () => {
    const out = transpile(`
      const seen: number[] = [];
      function addOne(v: number): number {
        seen.push(v + 1);
        return seen.length;
      }
      function bumpAll(nums: number[]): number {
        const grown = nums.map((n: number): number => addOne(n));
        return grown.length;
      }
      let k = bumpAll([1, 2]);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(noErr(out)).toHaveLength(0);
    expect(out.cpp).toMatch(/__tc_map\(nums/);
  });

  it("an inline type-literal parameter annotation synthesizes a struct", () => {
    const out = transpile(`
      function board(limit: { take: number }): number {
        return limit.take;
      }
      let n = board({ take: 3 });
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(noErr(out)).toHaveLength(0);
    expect(out.cpp).toMatch(/struct _board_limit_t/);
    expect(out.cpp).toMatch(/board\(const _board_limit_t& limit\)/);
    expect(out.cpp).not.toMatch(/board\(double limit\)/);
  });

  it("an array of records with closure fields emits its struct at file scope", () => {
    const out = transpile(`
      const sensors = [
        { label: 'T', base: 2300, read: (): number => 2300 + 1 },
        { label: 'H', base: 1800, read: (): number => 1800 + 2 },
      ];
      let n = 0;
      for (let i = 0; i < sensors.length; i += 1) {
        n += sensors[i].base;
      }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(noErr(out)).toHaveLength(0);
    const structAt = out.cpp.indexOf("struct _sensors_t");
    const useAt = out.cpp.search(/__tc_StaticArray<_sensors_t/);
    expect(structAt).toBeGreaterThan(-1);
    expect(useAt).toBeGreaterThan(-1);
    expect(structAt).toBeLessThan(useAt); // definition before the global that names it
    expect(out.cpp).toMatch(/std::function<double\(\)> read/);
  });

  it("multi-argument push lowers to sequenced push_backs keeping the length result", () => {
    const out = transpile(`
      function esc(out: number[]): number {
        out.push(1, 2);
        return out.push(3);
      }
      const o: number[] = [];
      let n = esc(o);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(noErr(out)).toHaveLength(0);
    expect(out.cpp).toMatch(/out\.push_back\(1\)/);
    expect(out.cpp).toMatch(/out\.push_back\(2\)/);
    expect(out.cpp).not.toMatch(/\.push\(1, 2\)/);
  });

  it("a promotion-seeded vector's own elements push_back (not verbatim .push)", () => {
    const out = transpile(`
      function build(): number {
        const out: number[] = [7];
        for (let i = 0; i < 3; i += 1) {
          out.push(i);
        }
        return out.length;
      }
      let n = build();
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(noErr(out)).toHaveLength(0);
    expect(out.cpp).not.toMatch(/out\.push\(/);
    expect(out.cpp).toMatch(/out\.push_back\(7\)/);
  });

  it("a const from a string element compares as a char against literals", () => {
    const out = transpile(`
      const s = 'a+b';
      let n = 0;
      for (let i = 0; i < s.length; i += 1) {
        const op = s[i];
        if (op === '+') {
          n += 1;
        }
        if (op !== '-') {
          n += 2;
        }
      }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(noErr(out)).toHaveLength(0);
    expect(out.cpp).toMatch(/op == '\+'/);
    expect(out.cpp).not.toMatch(/strcmp\(op/);
  });

  it("an object literal into a mutated record parameter becomes a named temporary", () => {
    const out = transpile(`
      type Cursor = { src: string; pos: number };
      function parseSum(c: Cursor): number {
        c.pos += 1;
        return c.pos;
      }
      function evalExpr(src: string): number {
        return parseSum({ src: src, pos: 0 });
      }
      let n = evalExpr('ab');
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(noErr(out)).toHaveLength(0);
    expect(out.cpp).toMatch(/Cursor __mutarg_parseSum_\d+ = /);
    expect(out.cpp).toMatch(/parseSum\(__mutarg_parseSum_\d+\)/);
  });

  it("labeled continue targets the OUTER loop and the machine labels are plain", () => {
    const out = transpile(`
      let n = 0;
      outer:
      for (let i = 0; i < 4; i += 1) {
        for (let j = 0; j < 4; j += 1) {
          if (j === 2) { continue outer; }
          if (i === 3) { break outer; }
          const double k = i + j;
          n += 1;
        }
      }
      while (true) {}
    `.replace("const double k = i + j;", "const k = i + j;"), { strategy: zephyr(), target: 'zephyr' });
    expect(noErr(out)).toHaveLength(0);
    expect(out.cpp).toMatch(/goto __continue_outer;/);
    expect(out.cpp).toMatch(/goto __break_outer;/);
    expect(out.cpp).toMatch(/__continue_outer: ;/);
    expect(out.cpp).toMatch(/__break_outer: ;/);
    // __attribute__((unused)) on a label is GNU C — g++ never registers the
    // label ("used but not defined").
    expect(out.cpp).not.toMatch(/__attribute__\(\(unused\)\) __continue_/);
    expect(out.cpp).not.toMatch(/__attribute__\(\(unused\)\) __break_/);
    // The continue label sits OUTSIDE an inner block that owns the body's
    // declarations (a forward goto over initializations is ill-formed):
    // "}" then "{" precede the label on the nesting path.
    const label = out.cpp.indexOf("__continue_outer: ;");
    expect(label).toBeGreaterThan(-1);
    expect(out.cpp.lastIndexOf("}", label)).toBeGreaterThan(
      out.cpp.lastIndexOf("{", out.cpp.lastIndexOf("}", label)));
  });

  it("a ternary with string arms picks a string snprintf format (both builders)", () => {
    const out = transpile(`
      function norm(v: number): number { return v * 2; }
      const rows = [1, 2];
      UART0.writeLine(\`n=\${rows.length} v=\${rows.length > 0 ? norm(rows[0]).toFixed(2) : '0.00'} t=\${rows.length > 0 ? 'yes' : 'no'}\`);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.diagnostics.filter(d => d.severity === "error" && d.code !== "zephyr-bus-instance-unavailable")).toHaveLength(0);
    expect(out.cpp).toMatch(/v=%s t=%s/);
    expect(out.cpp).toMatch(/\)\.c_str\(\)/); // the std::string conditional converts for varargs
  });

  it("Math.max(...vals) folds the vector through a helper", () => {
    const out = transpile(`
      function peak(...vals: number[]): number {
        return Math.max(...vals);
      }
      let a = peak(2, 7, 5);
      let b = Math.min(...[3, 1, 2]);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(noErr(out)).toHaveLength(0);
    expect(out.cpp).toMatch(/__tc_max_vec\(vals\)/);
    expect(out.cpp).toMatch(/__tc_min_vec\(/);
    expect(out.cpp).toMatch(/T __tc_max_vec\(/); // polyfill defined
  });

  it("AUTOSAR: the engine-generated labeled-break/continue goto is a recorded deviation", async () => {
    const { RULES } = await import("../../../packages/cuttlefish/src/emit/compliance/rules.js");
    const rule = RULES.find(r => r.id === "A8-4-4");
    expect(rule).toBeDefined();
    // The engine-lowering knownPattern classifies the machine-generated goto
    // as a recorded deviation, not an unrecorded violation.
    const known = rule!.knownPatterns?.find(kp => kp.detect.test("goto __continue_build;"));
    expect(known).toBeDefined();
    expect(known!.kind).toBe("engine-lowering");
    // A user-written goto stays a violation.
    expect(rule!.knownPatterns?.some(kp => kp.detect.test("goto retry;"))).toBeFalsy();
  });

  // ── DOCUMENTED-OPEN ─────────────────────────────────────────────────────
  it.fails("OPEN: name-keyed array prescan — a `rows` in one scope poisons another", () => {
    // mutableArrayVars/unboundedArrayVars are program-global by NAME. The
    // main-local `rows` (pushed in a loop → unbounded) makes leaderboard's
    // `rows` PARAMETER count as unbounded too: `[...rows]` loses the spread
    // and infers std::vector<int> (`copy = { }`). Fix direction: node-keyed
    // bookkeeping, the SemanticFacts design the type-checker already uses.
    const out = transpile(`
      type Row = { label: string; mean: number };
      function leaderboard(rows: Row[]): string {
        const copy = [...rows];
        copy.sort((a: Row, b: Row): number => a.mean - b.mean);
        return copy.length > 0 ? copy[0].label : '-';
      }
      let acc = '';
      for (let cycle = 0; cycle < 4; cycle += 1) {
        const rows: Row[] = [];
        for (let s = 0; s < 3; s += 1) {
          rows.push({ label: 'a', mean: 1 });
        }
        acc += leaderboard(rows);
      }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/std::vector<Row> copy\(rows\)/);
  });

  it.fails("OPEN: a block-bodied comparator declines the __tc_sort_fn lowering", () => {
    // The receiver's scope type is missing in the lowering pass that wins —
    // the call emits verbatim (`copy.sort(main_isr_0)`, no member sort).
    // Expression-bodied comparators lower (see the callback-methods test).
    const out = transpile(`
      type Row = { label: string; mean: number };
      function top(rows: Row[]): number {
        const copy = [...rows];
        copy.sort((a: Row, b: Row): number => {
          if (a.mean !== b.mean) {
            return b.mean - a.mean;
          }
          return -1;
        });
        return copy.length;
      }
      let n = top([{ label: 'a', mean: 1 }]);
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/__tc_sort_fn\(copy/);
  });

  it("union member access is rejected with an honest, self-consistent hint", () => {
    // Discriminated unions lower to std::variant (C++17) which this C++14
    // target rejects — and member access (including the discriminant read a
    // type guard would use) is not lowered. The hint must NOT recommend
    // "narrow via a type guard" (that is the rejected member access itself).
    const out = transpile(`
      type PktEvent =
        | { kind: 'frame'; label: string }
        | { kind: 'drop'; why: string };
      function handle(e: PktEvent): number {
        if (e.kind === 'frame') { return 1; }
        return 0;
      }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    // On this C++14 target the ALIAS itself is rejected first (std::variant
    // needs C++17); its remedy must match the member-access gate's — one
    // struct with a discriminator field, never "narrow via a type guard"
    // (reading the discriminant IS the rejected member access).
    const aliasErr = out.diagnostics.find(d => d.code === "variant-unsupported-on-target");
    expect(aliasErr).toBeDefined();
    expect(aliasErr!.message).toContain("struct with a kind field");
  });
});
