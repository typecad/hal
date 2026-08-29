// ---------------------------------------------------------------------------
// Demo #28 regressions — five transpiler gaps surfaced by a Brainfuck
// interpreter demo. All five are now FIXED in the transpiler; this file pins
// the behavior. The demo source has been reverted to its natural idiomatic
// form (braced switch cases, a module-level GLYPHS table indexed by a const
// enum, a free function called only as a nested argument, a function-init
// promoted const, and `String.*`-free character rendering) and recompiles
// clean with byte-for-byte identical, correct output.
//
//   A — `String.fromCharCode` / `String.*` statics were neither lowered NOR
//       lint/build-gated, so they silently emitted `String.fromCharCode(...)`
//       verbatim and failed at g++ time ("'String' was not declared"). The
//       feature registry now gates `String.*` and `Number.*` statics at lint
//       time (parity with `JSON.*`/`Object.*`) AND the feature prescan rejects
//       them at build time. `ir/feature-registry.ts`.
//
//   B — A top-level variable classified runtime AND referenced by a free
//       function is PROMOTED to a file-scope global. Its forward-declaration
//       default initializer was `'0'` for every non-pointer type, which is
//       invalid for class types (`std::vector<...> = 0;`). The default is now
//       `'{}'` (value-initialization, valid for every C++ type).
//       `emit/emitters/function-emitter-impl.ts`.
//
//   C — A free function called ONLY as a nested expression (an argument to
//       another call: `out.push(glyphFor(op))`) was tree-shaken. The call
//       statement's callee is a lowered raw wrapper
//       (`__RAW_STMT__out.push_back(glyphFor(op))`) and the identifier
//       collector only added `calleeParts[0]`, so the inner callee
//       (`glyphFor`) was invisible to the call graph. The collector now adds
//       EVERY callee part. `ir/identifier-collector.ts`.
//
//   D — A `switch` with BRACED case bodies (`case X: { ...; break; }`) lowered
//       to an `if/else if` chain but kept each `break;`. Inside a loop the
//       stray break silently exited the loop; outside a loop it was a hard g++
//       error. The break-stripping pass now recurses into a case body's
//       wrapping block(s). `emit/emitters/line-appender.ts`.
//
//   E — An enum-typed array index (`GLYPHS[op]` where `op: Op`) was not cast
//       to an integral type; a C++ `enum class` does not implicitly convert to
//       `size_t`, so `vector[enumValue]` failed to compile. Element-access
//       rendering now routes the index through `renderEnumSafeValue`, which
//       wraps numeric-enum operands in `static_cast<int>(...)`.
//       `emit/expression-renderer.ts`.
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

setLoadedFramework({ strategy: new NativeStrategy() });
registerPlatformStrategy(new NativeStrategy());

function transpileNativeSingle(tsCode: string) {
  return transpile(tsCode, { target: "native", emitMode: "single" });
}

// Full pipeline: build IR → call graph → reachability → filter → emit. This is
// what `cuttlefish build` runs; the plain `transpile()` helper skips
// tree-shaking (filterProgramIR), so Finding C only reproduces through here.
function transpileNativeFullPipeline(tsCode: string): string {
  setActiveStrategy(resolveStrategy("native"));
  const program = buildProgramIR("demo28_repro.ts", tsCode);
  const cg = buildCallGraph(program);
  const reach = analyzeReachability(program, cg, { target: "native" });
  const filtered = filterProgramIR(program, reach, { enabled: true });
  const result = emitCpp(filtered, {
    outDir: ".build/tests",
    emitMode: "cpp",
    target: "native",
    libdefs: new Map(),
    emitMaps: false,
  });
  let cpp = "";
  if (result.sourcePath && fs.existsSync(result.sourcePath)) {
    cpp = fs.readFileSync(result.sourcePath, "utf-8");
    fs.unlinkSync(result.sourcePath);
  }
  return cpp;
}

// ── A: String.* / Number.* statics are build-time rejected ──────────────────

describe("A: String.* / Number.* statics rejected", () => {
  it("flags String.fromCharCode with a TS2CPP_NO_EQUIVALENT error diagnostic", () => {
    const result = transpileNativeSingle(`
      export function main(): string { return String.fromCharCode(65); }
    `);
    const diags = result.diagnostics.filter(
      (d) => d.code === "TS2CPP_NO_EQUIVALENT" && /String\.fromCharCode|String-constructor/.test(d.message)
    );
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].severity).toBe("error");
  });

  it("flags Number.parseInt with a TS2CPP_NO_EQUIVALENT error diagnostic", () => {
    const result = transpileNativeSingle(`
      export function main(): int32_t { return Number.parseInt("5"); }
    `);
    const diags = result.diagnostics.filter(
      (d) => d.code === "TS2CPP_NO_EQUIVALENT" && /Number-constructor|Number\.parseInt/.test(d.message)
    );
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].severity).toBe("error");
  });
});

// ── B: promoted non-scalar global gets `{}` default init, not `= 0` ──────────

describe("B: promoted-var default initializer is {}", () => {
  it("emits `= {}` for a promoted std::vector global (not `= 0`)", () => {
    // A function-init top-level const referenced by a free function is
    // promoted to a file-scope global. Its default init must be `{}`.
    const cpp = transpileNativeSingle(`
      function build(): string[] { const t: string[] = ['a']; return t; }
      const TABLE: string[] = build();
      function read(): string { return TABLE[0]; }
      export function main(): void { const s: string = read(); }
    `).cpp ?? "";
    // Must NOT be the invalid `TABLE = 0;`.
    expect(cpp).not.toMatch(/TABLE\s*=\s*0\s*;/);
    // Must be value-initialized.
    expect(cpp).toMatch(/std::vector<std::string>\s+TABLE\s*=\s*\{\s*\}\s*;/);
  });
});

// ── C: nested-call free function survives tree-shaking ──────────────────────

describe("C: free function called only as a nested argument is kept", () => {
  it("keeps glyphFor when its only caller invokes it as out.push(glyphFor(op))", () => {
    const cpp = transpileNativeFullPipeline(`
      const enum Op { Nop = 0, Inc = 1 }
      function glyphFor(op: Op): string {
        if (op === Op.Inc) { return "+"; }
        return "?";
      }
      function classify(code: int32_t): Op { return code === 43 ? Op.Inc : Op.Nop; }
      function tokenize(source: string): string[] {
        const out: string[] = [];
        for (let i: int32_t = 0; i < source.length; i = i + 1) {
          const op: Op = classify(source.charCodeAt(i));
          if (op !== Op.Nop) { out.push(glyphFor(op)); }
        }
        return out;
      }
      export function main(): void { const t: string[] = tokenize("+"); }
    `);
    // glyphFor must be EMITTED (previously tree-shaken → g++ "not declared").
    expect(cpp).toMatch(/glyphFor/);
    // And it must be a real definition (with a body), not just a forward decl.
    expect(cpp).toMatch(/std::string glyphFor\([^)]*\)\s*\{/);
  });
});

// ── D: braced switch case bodies strip their break ──────────────────────────

describe("D: braced switch case bodies strip break in if/else lowering", () => {
  it("does not emit a stray break for a braced case body inside a loop", () => {
    const cpp = transpileNativeSingle(`
      const enum Op { A = 0, B = 1 }
      export function main(): int32_t {
        let total: int32_t = 0;
        let i: int32_t = 0;
        while (i < 2) {
          const op: Op = i === 0 ? Op.A : Op.B;
          switch (op) {
            case Op.A: { total = total + 1; break; }
            case Op.B: { total = total + 10; break; }
            default: { break; }
          }
          i = i + 1;
        }
        return total;
      }
    `).cpp ?? "";
    // The lowered if/else chain must contain NO `break;` (a stray break would
    // break the enclosing while → wrong control flow, or a hard g++ error).
    expect(cpp).not.toMatch(/\bbreak\s*;/);
  });

  it("does not emit a stray break for a braced case body outside a loop either", () => {
    const cpp = transpileNativeSingle(`
      const enum Op { A = 0, B = 1 }
      export function main(op: Op): int32_t {
        switch (op) {
          case Op.A: { return 1; }
          case Op.B: { return 2; }
          default: { return 0; }
        }
      }
    `).cpp ?? "";
    expect(cpp).not.toMatch(/\bbreak\s*;/);
  });

  it("regression: flat case bodies still strip break (no over-stripping)", () => {
    const cpp = transpileNativeSingle(`
      const enum Op { A = 0, B = 1 }
      export function main(op: Op): int32_t {
        switch (op) {
          case Op.A:
            return 1;
          case Op.B:
            return 2;
          default:
            return 0;
        }
      }
    `).cpp ?? "";
    expect(cpp).not.toMatch(/\bbreak\s*;/);
  });
});

// ── E: enum-typed array index is cast to int ────────────────────────────────

describe("E: enum-typed array index cast to int", () => {
  it("lowers GLYPHS[op] (op: const enum) to GLYPHS[static_cast<int>(op)]", () => {
    const cpp = transpileNativeSingle(`
      const enum Op { A = 0, B = 1 }
      const GLYPHS: string[] = ['?', '+'];
      export function main(op: Op): string { return GLYPHS[op]; }
    `).cpp ?? "";
    expect(cpp).toMatch(/GLYPHS\[static_cast<int>\(op\)\]/);
    expect(cpp).not.toMatch(/GLYPHS\[op\]/);
  });
});

// ── A-review: other ungated stdlib statics (Array.from/of, new Date) ────────
// Same family as Finding A: APIs that were neither lowered nor gated, so they
// emitted verbatim and failed at g++ time. Now gated at lint + build time.

describe("A-review: Array.from/of and new Date are rejected", () => {
  it("rejects Array.from at build time", () => {
    const result = transpileNativeSingle(`
      export function main(x: int32_t[]): int32_t[] { return Array.from(x); }
    `);
    expect(result.diagnostics.some((d) => d.code === "TS2CPP_NO_EQUIVALENT" && /Array\.from/.test(d.message))).toBe(true);
  });

  it("rejects Array.of at build time", () => {
    const result = transpileNativeSingle(`
      export function main(): int32_t[] { return Array.of(1, 2); }
    `);
    expect(result.diagnostics.some((d) => d.code === "TS2CPP_NO_EQUIVALENT" && /Array\.of/.test(d.message))).toBe(true);
  });

  it("does NOT reject Array.isArray (a compile-time type check that IS lowered)", () => {
    const result = transpileNativeSingle(`
      export function main(x: int32_t): boolean { return Array.isArray(x); }
    `);
    expect(result.diagnostics.some((d) => d.code === "TS2CPP_NO_EQUIVALENT")).toBe(false);
  });

  it("rejects new Date() at build time", () => {
    const result = transpileNativeSingle(`
      export function main(): int32_t { const d = new Date(); return 1; }
    `);
    expect(result.diagnostics.some((d) => d.code === "TS2CPP_NO_EQUIVALENT" && /new Date|Date\/calendar/.test(d.message))).toBe(true);
  });
});

// ── E-review: enum-typed Map key cast (set/has/get, statement + expression) ─
// Finding E surfaced an enum array index; the same enum→integral gap applies to
// a bare enum-typed Map key, and the existing enum-key cast only covered enum
// MEMBER access (Color.Red) and only the .set statement form. Now covers a bare
// enum-typed key variable across .set/.has/.get/.delete in both statement and
// expression positions.

describe("E-review: bare enum-typed Map key cast", () => {
  it("casts a bare enum key on m.set / m.has / m.get (expression + statement form)", () => {
    const cpp = transpileNativeSingle(`
      const enum K { A = 0, B = 1 }
      export function main(m: Map<int32_t, int32_t>, k: K): int32_t {
        m.set(k, 1);                       // statement form
        if (m.has(k)) { return m.get(k)!; } // expression form
        return 0;
      }
    `).cpp ?? "";
    // .set  → m[static_cast<int32_t>(k)] = 1
    expect(cpp).toMatch(/\[static_cast<int32_t>\(k\)\]\s*=\s*1/);
    // .has  → m.count(static_cast<int32_t>(k))
    expect(cpp).toMatch(/\.count\(static_cast<int32_t>\(k\)\)/);
    // .get  → m.at(static_cast<int32_t>(k))
    expect(cpp).toMatch(/\.at\(static_cast<int32_t>\(k\)\)/);
    // And no uncast bare-k key access survives.
    expect(cpp).not.toMatch(/\[(k)\]/);
    expect(cpp).not.toMatch(/\.(count|at)\((k)\)/);
  });

  it("still casts enum MEMBER access keys (no regression of the pre-existing path)", () => {
    const cpp = transpileNativeSingle(`
      const enum K { A = 0, B = 1 }
      export function main(m: Map<int32_t, int32_t>): int32_t {
        m.set(K.A, 1);
        return m.has(K.A) ? m.get(K.A)! : 0;
      }
    `).cpp ?? "";
    expect(cpp).toMatch(/static_cast<int32_t>\(K::A\)/);
  });

  it("does NOT cast a plain int key (no over-casting)", () => {
    const cpp = transpileNativeSingle(`
      export function main(m: Map<int32_t, int32_t>, k: int32_t): int32_t {
        m.set(k, 1);
        return m.get(k)!;
      }
    `).cpp ?? "";
    expect(cpp).toMatch(/\[k\]/);
    expect(cpp).toMatch(/\.at\(k\)/);
    expect(cpp).not.toMatch(/static_cast<int32_t>\(k\)/);
  });
});
