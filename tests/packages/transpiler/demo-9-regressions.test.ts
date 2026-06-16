// ---------------------------------------------------------------------------
// Regression tests for transpiler gaps surfaced by Demo #9 (Conduit pipeline).
//
// Fixes covered:
//   C — parseInt/parseFloat emit .c_str() so atoi/atof accept std::string
//   A — discriminated union → std::variant registers the <variant> include
//
// Documented (not yet fixed) — see README:
//   B — nested function declarations inside a factory aren't hoisted above the
//       return statement in emitted C++
//   D — `T | null` comparison emits `valueType == nullptr` (invalid for vectors)
//   E — union dispatch function double-emits (header + cpp)
//   F — the `bind|call|apply` lint selector bans any method named `apply`/
//       `call`/`bind`, even legitimate ones not rebinding `this`
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { transpile } from "../../setup";

function transpileNativeSplit(tsCode: string) {
  return transpile(tsCode, { target: "native", emitMode: "split" });
}

// ---------------------------------------------------------------------------
// C: parseInt / parseFloat emit .c_str()
// ---------------------------------------------------------------------------
describe("C: parseInt / parseFloat on a std::string", () => {
  it("parseInt(s) emits atoi((s).c_str())", () => {
    const result = transpileNativeSplit(
      [
        "export function f(s: string): int32_t {",
        "  return parseInt(s, 10);",
        "}",
        "",
      ].join("\n"),
    );
    const cpp = result.cpp ?? "";
    expect(cpp).toMatch(/atoi\(/);
    expect(cpp).toContain(".c_str()");
  });

  it("parseFloat(s) emits atof((s).c_str())", () => {
    const result = transpileNativeSplit(
      [
        "export function f(s: string): double {",
        "  return parseFloat(s);",
        "}",
        "",
      ].join("\n"),
    );
    const cpp = result.cpp ?? "";
    expect(cpp).toMatch(/atof\(/);
    expect(cpp).toContain(".c_str()");
  });
});

// ---------------------------------------------------------------------------
// A: discriminated union → std::variant includes <variant>
// ---------------------------------------------------------------------------
describe("A: discriminated union includes <variant>", () => {
  it("a union type alias registers the <variant> include", () => {
    const result = transpileNativeSplit(
      [
        "export interface A { kind: string; a: int32_t; }",
        "export interface B { kind: string; b: int32_t; }",
        "export type U = A | B;",
        "",
      ].join("\n"),
    );
    const header = result.header ?? "";
    // The alias lowers to std::variant<...>, which needs <variant>.
    expect(header).toMatch(/std::variant</);
    expect(header).toContain("#include <variant>");
  });
});

// ---------------------------------------------------------------------------
// B: nested function declaration — alias mangling on a bare identifier reference
// ---------------------------------------------------------------------------
describe("B: nested function return reference", () => {
  it("return nestedFn emits the mangled hoisted name, not the bare name", () => {
    const result = transpileNativeSplit(
      [
        "export function factory(): (x: int32_t) => int32_t {",
        "  function inner(x: int32_t): int32_t { return x + 1; }",
        "  return inner;",
        "}",
        "const f = factory();",
        "console.log(f(5));",
        "",
      ].join("\n"),
    );
    const cpp = result.cpp ?? "";
    // The return must reference the mangled name (factory__inner), not `inner`.
    expect(cpp).toMatch(/factory__inner/);
    expect(cpp).not.toMatch(/return inner;/);
  });
});

// ---------------------------------------------------------------------------
// D: value-type null comparison resolves to a compile-time boolean
// ---------------------------------------------------------------------------
describe("D: T | null comparison on a value type", () => {
  it("xs === null on a vector param resolves to false (not vector == nullptr)", () => {
    const result = transpileNativeSplit(
      [
        "export function f(xs: int32_t[] | null): int32_t {",
        "  if (xs === null) return -1;",
        "  return xs[0]!;",
        "}",
        "",
      ].join("\n"),
    );
    const cpp = result.cpp ?? "";
    // Must NOT emit `xs == nullptr` (invalid for a vector value type).
    expect(cpp).not.toMatch(/xs\s*==\s*nullptr/);
    expect(cpp).not.toMatch(/nullptr\s*==\s*xs/);
  });
});

// ---------------------------------------------------------------------------
// E: discriminated-union member access is gated (semantic gate)
// ---------------------------------------------------------------------------
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { runSemanticGates } from "../../../packages/cuttlefish/src/testing";

describe("E: union member access (semantic gate)", () => {
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cuttlefish-demo9-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("flags m.kind on a union type", () => {
    const file = writeFile("main.ts", [
      "export interface A { kind: string; a: int32_t; }",
      "export interface B { kind: string; b: int32_t; }",
      "export type U = A | B;",
      "export function f(u: U): int32_t {",
      "  return u.kind === 'a' ? u.a : u.b;",
      "}",
      "",
    ].join("\n"));
    const program = buildProgram([file]);
    const diags = runSemanticGates(program, [file]);
    expect(codes(diags)).toContain("TS2CPP_UNION_MEMBER_ACCESS");
  });
});
