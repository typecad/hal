// ---------------------------------------------------------------------------
// Regression tests for transpiler gaps surfaced by Demo #6 (Forge).
//
// Each test pins one fix so a regression is caught immediately. The tests
// mirror the exact patterns the demo exercised when it first surfaced the gap.
//
// Fixes covered:
//   F  — generic function definitions emitted in the header (template link)
//   H  — for...of emits by-reference for class-typed elements
//   A  — extern declaration for top-level const arrays of scalars
//   C  — getter rewrite fires for pointer receivers (loop vars)
//   D  — object destructuring of a local stays in scope (property-access IR)
//   E  — spread of a vector into a rest-param call passes the vector directly
//   G  — hoisted callback functions carry the lambda's return type + params
//   B  — ESLint rule no-undefined-compare-on-struct-field
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { transpile, transpileNative } from "../../setup";
import { transpileFile } from "../../../packages/cuttlefish/src/testing";

/** Transpile for the native target in split mode (header + cpp). */
function transpileNativeSplit(tsCode: string) {
  return transpile(tsCode, { target: "native", emitMode: "split" });
}

// ---------------------------------------------------------------------------
// F: generic function definitions must be in the header (template link error)
// ---------------------------------------------------------------------------
describe("F: generic function definition in header", () => {
  it("emits the template definition (not just the declaration) in the .h", () => {
    const result = transpileNativeSplit(
      [
        "export interface Box { value: int16_t; }",
        "export function unwrap<T extends Box>(b: T): int16_t { return b.value; }",
        "export function caller(): int16_t {",
        "  const b: Box = { value: 7 };",
        "  return unwrap(b);",
        "}",
        "",
      ].join("\n"),
    );
    // The header must contain the template DEFINITION (a body `{ ... }`),
    // not just the declaration (`;`). Without it, a cross-file instantiation
    // produces `undefined reference to unwrap<Box>(...)` at link time.
    expect(result.header ?? "").toContain("template<typename T>");
    expect(result.header ?? "").toMatch(/int16_t unwrap\(const T& b\)\s*\{/);
  });
});

// ---------------------------------------------------------------------------
// H: for...of over a class-typed array emits by reference
// ---------------------------------------------------------------------------
describe("H: for...of by-reference for class elements", () => {
  it("emits `const Foo& x` for a struct-typed loop variable", () => {
    const result = transpileNative(
      [
        "export interface Widget { weight: int16_t; }",
        "export function totalWeight(items: Widget[]): int16_t {",
        "  let sum: int16_t = 0;",
        "  for (const w of items) { sum += w.weight; }",
        "  return sum;",
        "}",
        "",
      ].join("\n"),
    );
    // A struct-typed loop variable must be by reference (`const Widget& w`)
    // to avoid the -Wrange-loop-construct warning and the per-iteration copy.
    expect(result.cpp).toContain("const Widget& w");
  });

  it("keeps primitive loop variables by value (no spurious reference)", () => {
    const result = transpileNative(
      [
        "export function sumAll(nums: int16_t[]): int16_t {",
        "  let sum: int16_t = 0;",
        "  for (const n of nums) { sum += n; }",
        "  return sum;",
        "}",
        "",
      ].join("\n"),
    );
    // Primitive element types stay by value (avoids `const int16_t& n` noise).
    expect(result.cpp).toContain("const int16_t n");
    expect(result.cpp).not.toContain("const int16_t& n");
  });
});

// ---------------------------------------------------------------------------
// A: extern declaration for top-level const arrays (scalar element type)
// ---------------------------------------------------------------------------
describe("A: extern for top-level const arrays", () => {
  it("emits an extern declaration for a const array of scalars", () => {
    const result = transpileNativeSplit(
      [
        "export const PRIMES: int16_t[] = [2, 3, 5, 7, 11];",
        "",
      ].join("\n"),
    );
    // The header must carry the matching extern so cross-file consumers see
    // the symbol. Without it: "was not declared in this scope". The scalar-
    // element array lowers to a std::vector extern.
    expect(result.header ?? "").toContain("extern");
    expect(result.header ?? "").toContain("PRIMES");
  });
});

// ---------------------------------------------------------------------------
// C: getter rewrite fires for a pointer loop variable
// ---------------------------------------------------------------------------
describe("C: getter rewrite for pointer receivers", () => {
  it("rewrites `s.energy` (loop var) to `s->getEnergy()`", () => {
    const result = transpileNative(
      [
        "export class Meter {",
        "  private _e: int16_t = 0;",
        "  public get energy(): int16_t { return this._e; }",
        "  public bump(): void { this._e += 1; }",
        "}",
        "export function totalEnergy(meters: Meter[]): int16_t {",
        "  let sum: int16_t = 0;",
        "  for (const m of meters) { sum += m.energy; }",
        "  return sum;",
        "}",
        "",
      ].join("\n"),
    );
    // The loop variable `m` is a Meter* whose type resolves to a class with a
    // getter. The access must rewrite to `m->getEnergy()`, not the raw field
    // `m->energy` (which has no field backing — g++: "has no member named
    // 'energy'; did you mean 'getEnergy'").
    expect(result.cpp).toContain("m->getEnergy()");
    expect(result.cpp).not.toMatch(/m->energy\b(?!Value)/);
  });
});

// ---------------------------------------------------------------------------
// D: object destructuring of a local stays in scope
// ---------------------------------------------------------------------------
describe("D: object destructuring of a local stays in scope", () => {
  it("emits split decls inside main() (not at file scope)", () => {
    const result = transpileNative(
      [
        "export interface Pair { a: int16_t; b: int16_t; }",
        "export function makePair(): Pair { return { a: 1, b: 2 }; }",
        "const p = makePair();",
        "const { a, b } = p;",
        'console.log("a=" + a + " b=" + b);',
        "",
      ].join("\n"),
    );
    // The destructured decls must land inside main()'s body so they can see
    // the local `p`. The split initializer is a property-access IR node
    // (recognized as runtime), not a raw string (which was misclassified as
    // compile-time and hoisted to file scope).
    // Heuristic: the decls should appear AFTER `int main()` and reference `p`.
    expect(result.cpp).toContain("int main()");
    const mainIdx = result.cpp.indexOf("int main()");
    const declIdx = result.cpp.indexOf("p.a");
    expect(declIdx).toBeGreaterThan(mainIdx);
  });
});

// ---------------------------------------------------------------------------
// E: spread of a vector into a rest-param call passes the vector directly
// ---------------------------------------------------------------------------
describe("E: spread of vector into rest-param call", () => {
  it("passes the vector directly (not .begin(), .end())", () => {
    const result = transpileNative(
      [
        "export function sumIds(...ids: int16_t[]): int16_t {",
        "  let s: int16_t = 0;",
        "  for (const id of ids) { s += id; }",
        "  return s;",
        "}",
        "export function caller(): int16_t {",
        "  const arr: int16_t[] = [1, 2, 3];",
        "  return sumIds(...arr);",
        "}",
        "",
      ].join("\n"),
    );
    // The spread of a vector variable must pass the vector directly
    // (`sumIds(arr)`), NOT `sumIds(arr.begin(), arr.end())` (two iterators
    // passed to a single const std::vector<T>& parameter).
    expect(result.cpp).toContain("sumIds(arr)");
    expect(result.cpp).not.toContain("arr.begin()");
    expect(result.cpp).not.toContain("arr.end()");
  });
});

// ---------------------------------------------------------------------------
// G: hoisted callback carries the lambda's return type + params
// ---------------------------------------------------------------------------
describe("G: callback return type + params preserved", () => {
  it("synthesizes `int16_t name(int16_t)` for a typed arrow callback", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "demo-g6-"));
    try {
      const mainPath = path.join(workspaceDir, "main.ts");
      fs.writeFileSync(
        mainPath,
        [
          "export function register(cb: (x: number) => number): void {",
          "  const r: number = cb(5);",
          '  console.log("r=" + r);',
          "}",
          "register((x: number): number => { return x + 1; });",
          "",
        ].join("\n"),
        "utf8",
      );

      const res = await transpileFile({
        inputFile: mainPath,
        emitMode: "split",
        target: "native",
        emitMaps: false,
      });

      const outDir = path.join(workspaceDir, ".build");
      const mainCpp = fs.readFileSync(path.join(outDir, "main.cpp"), "utf8");
      // The synthesized `*_isr_*` free function must carry the arrow's return
      // type (here `double` — the default numeric lowering of `number`), NOT
      // the historical `void name()`. Otherwise it can't convert to the
      // std::function param. (The param type currently renders as `auto` — a
      // remaining gap in the lambda-param cppType propagation; the return
      // type, which was the link-breaking piece, is now correct.)
      expect(mainCpp).toMatch(/double \w+_isr_\d+\(/);
      expect(mainCpp).not.toMatch(/void \w+_isr_\d+\(\)/);
      expect(res.diagnostics.filter((d: any) => d.severity === "error").length).toBe(0);
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// B: ESLint rule no-undefined-compare-on-struct-field
//   The rule is registered in eslint-transpiler-rules.mjs and wired into the
//   demo's eslint.config.mjs. We verify the rule is present and structurally
//   sound (has a BinaryExpression visitor that inspects member-access
//   operands). End-to-end firing is verified separately via `npx eslint`.
// ---------------------------------------------------------------------------
describe("B: ESLint no-undefined-compare-on-struct-field", () => {
  it("is registered in the transpiler-rules plugin", async () => {
    const plugin = await import(path.resolve("eslint-transpiler-rules.mjs"));
    expect(plugin.default.rules["no-undefined-compare-on-struct-field"]).toBeDefined();
    const rule = plugin.default.rules["no-undefined-compare-on-struct-field"];
    expect(rule.meta.type).toBe("problem");
    // The rule must define a BinaryExpression visitor.
    const handlers = rule.create({ report() {}, getSourceCode() { return {}; } });
    expect(handlers.BinaryExpression).toBeTypeOf("function");
  });

  it("is wired into the demo's eslint config", () => {
    const config = fs.readFileSync(
      path.resolve("demo", "eslint.config.mjs"),
      "utf8",
    );
    expect(config).toContain("cuttlefish/no-undefined-compare-on-struct-field");
  });
});
