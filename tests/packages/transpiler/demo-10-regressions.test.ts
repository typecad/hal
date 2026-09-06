// ---------------------------------------------------------------------------
// Regression tests for transpiler gaps surfaced by Demo #10 (Ledger).
//
// Fixes covered:
//   A — utility-type aliases (Partial<T>/Pick/Omit → T) survive tree-shaking
//       AND interfaces emit before aliases (so `using X = Entry;` resolves).
//
// Documented (not yet fixed) — see README:
//   B — Partial<T>/Pick<T,K>/Omit<T,K> resolve to the FULL struct (C++ structs
//       have fixed shape); values must provide all fields.
//   C — `typeof x` on an int32_t returns "object" (the static fallback).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";

function transpileNativeSplit(tsCode: string) {
  return transpile(tsCode, { target: "native", emitMode: "split" });
}

// ---------------------------------------------------------------------------
// A: utility-type alias survives + interface-before-alias ordering
// ---------------------------------------------------------------------------
describe("A: utility-type alias emits after the interface", () => {
  it("type Patch = Partial<Entry> emits `using Patch = Entry;` after `struct Entry`", () => {
    const result = transpileNativeSplit(
      [
        "export interface Entry { id: int32_t; value: double; }",
        "export type Patch = Partial<Entry>;",
        "export function f(p: Patch): int32_t { return p.id; }",
        "const p: Patch = { id: 1, value: 2 };",
        "const _log1 = f(p);",
        "",
      ].join("\n"),
    );
    const header = result.header ?? "";
    // The alias must emit.
    expect(header).toMatch(/using\s+Patch\s*=\s*Entry/);
    // The struct must come BEFORE the using (so Entry is declared).
    const structIdx = header.indexOf("struct Entry");
    const usingIdx = header.indexOf("using Patch");
    expect(structIdx).toBeGreaterThan(-1);
    expect(usingIdx).toBeGreaterThan(-1);
    expect(usingIdx).toBeGreaterThan(structIdx);
  });
});

// ---------------------------------------------------------------------------
// C: typeof on an int32_t returns "number" (not "object")
// ---------------------------------------------------------------------------
describe("C: typeof on primitive types", () => {
  it("typeof x where x: int32_t returns 'number'", () => {
    const result = transpileNativeSplit(
      [
        "export function f(x: int32_t): string {",
        "  return typeof x;",
        "}",
        "const _log2 = f(42);",
        "",
      ].join("\n"),
    );
    const cpp = result.cpp ?? "";
    // The typeof must resolve to the literal "number", not "object".
    expect(cpp).toContain('"number"');
    expect(cpp).not.toContain('"object"');
  });

  it("typeof s where s: string returns 'string'", () => {
    const result = transpileNativeSplit(
      [
        "export function f(s: string): string {",
        "  return typeof s;",
        "}",
        "const _log3 = f('hi');",
        "",
      ].join("\n"),
    );
    const cpp = result.cpp ?? "";
    expect(cpp).toContain('"string"');
  });
});
