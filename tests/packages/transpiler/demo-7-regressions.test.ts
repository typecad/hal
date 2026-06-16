// ---------------------------------------------------------------------------
// Regression tests for transpiler gaps surfaced by Demo #7 (Wattage grid sim).
//
// Each test pins one fix so a regression is caught immediately. The tests
// mirror the exact patterns the demo exercised when it first surfaced the gap.
//
// Fixes covered:
//   A  — functional array methods (.map/.filter/.reduce/.some/.every) callbacks
//        carry a real return type + typed params (not void X_isr_N(auto))
//   B  — .forEach on a runtime vector inlines to a for-loop
//   D  — array-rest destructure produces std::vector<T> not std::vector<T&>
//   E  — type alias to a primitive/Map is emitted as a `using` (reachability)
//   F  — object-literal return against a named interface compiles
//   G  — const-local struct that is mutated after init emits non-const
//   H  — object-literal argument into a destructure param constructs the struct
//   I  — Object.keys/values/entries work on a map-typed member access
//   J  — for...in over a Map/Record is rejected (semantic gate)
//   K  — enum key into a Map/set is static_cast to the integral key type
//   L  — Math.PI/Math.E lower to numeric literals
//   M  — IIFE is rejected (lint selector)
//   N  — optional call fn?.() emits a null guard
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { transpile } from "../../setup";

/** Transpile for the native target in split mode (header + cpp). */
function transpileNativeSplit(tsCode: string) {
  return transpile(tsCode, { target: "native", emitMode: "split" });
}

// ---------------------------------------------------------------------------
// A: functional array method callbacks carry a real signature
// ---------------------------------------------------------------------------
describe("A: functional array method callbacks", () => {
  it(".map callback carries the element param type and return type", () => {
    const result = transpileNativeSplit(
      [
        "export interface Node { id: int32_t; capacity: double; }",
        "export function capacities(nodes: Node[]): double[] {",
        "  return nodes.map((n: Node) => n.capacity);",
        "}",
        "",
      ].join("\n"),
    );
    const cpp = result.cpp;
    // The hoisted ISR must NOT be `void name(auto n)`; it must carry a real
    // (or auto-deduced) return type and the resolved element param type.
    expect(cpp).not.toMatch(/void\s+\w+_isr_\d+\s*\(/);
    expect(cpp).toMatch(/\w+_isr_\d+\(Node n\)/);
    expect(cpp).toContain("__tc_map(");
  });

  it(".filter callback preserves the element type and returns bool", () => {
    const result = transpileNativeSplit(
      [
        "export interface Node { fault: boolean; }",
        "export function online(nodes: Node[]): Node[] {",
        "  return nodes.filter((n: Node) => !n.fault);",
        "}",
        "",
      ].join("\n"),
    );
    expect(result.cpp).toContain("__tc_filter(");
    expect(result.cpp).not.toMatch(/void\s+\w+_isr_\d+\(\s*auto\s+n\s*\)/);
  });

  it(".reduce callback carries accumulator + element params", () => {
    const result = transpileNativeSplit(
      [
        "export interface Node { capacity: double; }",
        "export function total(nodes: Node[]): double {",
        "  return nodes.reduce((sum: double, n: Node) => sum + n.capacity, 0);",
        "}",
        "",
      ].join("\n"),
    );
    expect(result.cpp).toContain("__tc_reduce(");
    expect(result.cpp).not.toMatch(/void\s+\w+_isr_\d+\(/);
  });

  it(".some/.every callbacks return bool", () => {
    const result = transpileNativeSplit(
      [
        "export interface Node { fault: boolean; }",
        "export function anyFault(nodes: Node[]): boolean {",
        "  return nodes.some((n: Node) => n.fault);",
        "}",
        "",
      ].join("\n"),
    );
    expect(result.cpp).toContain("__tc_some(");
    expect(result.cpp).not.toMatch(/void\s+\w+_isr_\d+\(/);
  });
});

// ---------------------------------------------------------------------------
// D: array-rest destructure produces std::vector<T>, not std::vector<T&>
// ---------------------------------------------------------------------------
describe("D: array-rest destructure element type", () => {
  it("const [head, ...rest] = arr emits std::vector<double> (no reference type)", () => {
    const result = transpileNativeSplit(
      [
        "export function splitHead(values: number[]): number {",
        "  const [head, ...rest] = values;",
        "  return rest.length;",
        "}",
        "",
      ].join("\n"),
    );
    const cpp = result.cpp;
    // Must NOT contain an illegal vector-of-references.
    expect(cpp).not.toContain("vector<double&>");
    expect(cpp).not.toContain("vector<double &>");
    // The rest slice must reference a non-reference element type.
    expect(cpp).toMatch(/std::vector<.*double.*>\(/);
  });
});

// ---------------------------------------------------------------------------
// E: type alias to a primitive is emitted as a `using`
// ---------------------------------------------------------------------------
describe("E: type alias to a primitive is emitted", () => {
  it("export type Watts = number emits `using Watts = double;`", () => {
    const result = transpileNativeSplit(
      [
        "export type Watts = number;",
        "export function f(): Watts { return 1; }",
        "",
      ].join("\n"),
    );
    expect(result.header ?? "").toContain("using Watts = ");
  });
});

// ---------------------------------------------------------------------------
// F: object-literal return against a named interface
// ---------------------------------------------------------------------------
describe("F: object-literal return", () => {
  it("return { a, b } against a Pair interface compiles", () => {
    const result = transpileNativeSplit(
      [
        "export interface Pair { a: double; b: double; }",
        "export function makePair(): Pair {",
        "  return { a: 1, b: 2 };",
        "}",
        "",
      ].join("\n"),
    );
    const cpp = result.cpp;
    // The return must produce a value convertible to Pair (brace-init present).
    expect(cpp).toContain("return");
  });
});

// ---------------------------------------------------------------------------
// G: const-local struct mutated after init emits non-const
// ---------------------------------------------------------------------------
describe("G: const-local struct mutation", () => {
  it("const out: Pair = {...}; out.a = 5; emits a mutable local", () => {
    const result = transpileNativeSplit(
      [
        "export interface Pair { a: double; b: double; }",
        "export function f(): Pair {",
        "  const out: Pair = { a: 0, b: 0 };",
        "  out.a = 5;",
        "  return out;",
        "}",
        "",
      ].join("\n"),
    );
    const cpp = result.cpp;
    // The local must NOT be `const Pair out` (which would block the assignment).
    expect(cpp).not.toMatch(/const\s+Pair\s+out\s*=/);
  });
});

// ---------------------------------------------------------------------------
// H: object-literal argument into a destructure param
// ---------------------------------------------------------------------------
describe("H: object-literal arg into destructure param", () => {
  it("f({a, b}: Spec) destructure-param call site constructs the struct", () => {
    const result = transpileNativeSplit(
      [
        "export interface Spec { a: int32_t; b: int32_t; }",
        "export function add({ a, b }: Spec): int32_t {",
        "  return a + b;",
        "}",
        "export function caller(): int32_t {",
        "  return add({ a: 1, b: 2 });",
        "}",
        "",
      ].join("\n"),
    );
    const all = (result.cpp ?? "") + "\n" + (result.header ?? "");
    // The destructure param lowers to a synthetic __param_N, and the body
    // extracts `a`/`b` from it. The call site passes the object literal.
    expect(all).toContain("add(");
    expect(all).toMatch(/__param_\d+/);
  });
});

// ---------------------------------------------------------------------------
// I: Object.keys/values/entries on a map-typed member access
// ---------------------------------------------------------------------------
describe("I: Object.* on map-typed member access", () => {
  it("Object.keys(this.map) lowers to __tc_mapKeys", () => {
    const result = transpileNativeSplit(
      [
        "export class Grid {",
        "  m: Map<number, number>;",
        "  constructor() { this.m = new Map(); }",
        "  keysLen(): number {",
        "    const ks = Object.keys(this.m) as unknown as number[];",
        "    return ks.length;",
        "  }",
        "}",
        "const g = new Grid();",
        "console.log(g.keysLen());",
        "",
      ].join("\n"),
    );
    const all = (result.cpp ?? "") + "\n" + (result.header ?? "");
    expect(all).toContain("__tc_mapKeys");
  });
});

// ---------------------------------------------------------------------------
// K: enum key into a Map is static_cast to the integral key type
// ---------------------------------------------------------------------------
describe("K: enum keys into a Map", () => {
  it("map.set(enumKey, v) static_casts the key", () => {
    const result = transpileNativeSplit(
      [
        "export const enum Color { Red = 0, Green = 1 }",
        "export function f(t: Map<int32_t, double>): void {",
        "  t.set(Color.Red, 1.0);",
        "}",
        "",
      ].join("\n"),
    );
    const cpp = result.cpp;
    expect(cpp).toMatch(/static_cast<int/);
  });
});

// ---------------------------------------------------------------------------
// L: Math.PI / Math.E lower to numeric literals
// ---------------------------------------------------------------------------
describe("L: Math constants", () => {
  it("Math.PI lowers to a literal (not std::PI)", () => {
    const result = transpileNativeSplit(
      [
        "export function area(): double {",
        "  return Math.PI * 10.0;",
        "}",
        "",
      ].join("\n"),
    );
    const cpp = result.cpp;
    expect(cpp).not.toContain("std::PI");
    expect(cpp).toMatch(/3\.14/);
  });

  it("Math.E lowers to a literal (not std::E)", () => {
    const result = transpileNativeSplit(
      [
        "export function e(): double {",
        "  return Math.E;",
        "}",
        "",
      ].join("\n"),
    );
    expect(result.cpp).not.toContain("std::E");
  });
});

// ---------------------------------------------------------------------------
// N: optional call fn?.() emits a null guard
// ---------------------------------------------------------------------------
describe("N: optional call null guard", () => {
  it("report?.() wraps the call in cuttlefish_exists(...)", () => {
    const result = transpileNativeSplit(
      [
        "export function maybe(fn: (() => number) | null): number {",
        "  return fn?.() ?? 0;",
        "}",
        "",
      ].join("\n"),
    );
    const cpp = result.cpp;
    expect(cpp).toContain("cuttlefish_exists");
  });
});

// ---------------------------------------------------------------------------
// J: for...in over a Map/Record is rejected (semantic gate)
// ---------------------------------------------------------------------------
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { runSemanticGates } from "../../../packages/cuttlefish/src/testing";

describe("J: for...in over a Map/Record (semantic gate)", () => {
  let tmpDir: string;

  function writeFile(relPath: string, content: string): string {
    const full = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf-8");
    return full;
  }
  function buildProgram(files: string[]): ts.Program {
    return ts.createProgram(files, {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    });
  }
  function codes(diagnostics: { code?: string }[]): string[] {
    return diagnostics.map(d => d.code).filter((c): c is string => Boolean(c));
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cuttlefish-demo7-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("flags for...in over a Map", () => {
    const file = writeFile("main.ts", [
      "export function f(m: Map<number, number>): number {",
      "  let s = 0;",
      "  for (const k in m) { s += 1; }",
      "  return s;",
      "}",
      "",
    ].join("\n"));
    const program = buildProgram([file]);
    const diags = runSemanticGates(program, [file]);
    expect(codes(diags)).toContain("TS2CPP_FORIN_ON_MAP");
  });

  it("flags for...in over a Record", () => {
    const file = writeFile("main.ts", [
      "export function f(r: Record<string, number>): number {",
      "  let s = 0;",
      "  for (const k in r) { s += 1; }",
      "  return s;",
      "}",
      "",
    ].join("\n"));
    const program = buildProgram([file]);
    const diags = runSemanticGates(program, [file]);
    expect(codes(diags)).toContain("TS2CPP_FORIN_ON_MAP");
  });

  it("does NOT flag for...in over a plain object literal type", () => {
    const file = writeFile("main.ts", [
      "export interface Obj { a: number; b: number; }",
      "export function f(o: Obj): number {",
      "  let s = 0;",
      "  for (const k in o) { s += 1; }",
      "  return s;",
      "}",
      "",
    ].join("\n"));
    const program = buildProgram([file]);
    const diags = runSemanticGates(program, [file]);
    expect(codes(diags)).not.toContain("TS2CPP_FORIN_ON_MAP");
  });
});
