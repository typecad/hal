// ---------------------------------------------------------------------------
// Tests for the Phase 3 semantic gates (TypeChecker-based):
//   - TS2CPP_HETEROGENEOUS_ARRAY  (type-resolved, contextual tuple exemption)
//   - TS2CPP_NEW_ON_INTERFACE     (symbol-based, cross-file)
//
// These build a real ts.Program so the TypeChecker resolves symbols and types,
// then call runSemanticGates directly. Per Q2, numeric widening is allowed
// ([1, true] is OK; only genuinely incompatible mixes like [1, "a"] reject).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import ts from "typescript";
import { runSemanticGates } from "@typecad/cuttlefish/testing";

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
  // Use the OS temp dir — runSemanticGates deliberately skips files under
  // node_modules/ and packages/, so the fixture must live elsewhere.
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cuttlefish-semantic-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("semantic gates: heterogeneous array literals (TS2CPP_HETEROGENEOUS_ARRAY)", () => {
  it("flags [1, \"a\"] (number + string)", () => {
    const file = writeFile("main.ts", "const x = [1, \"a\"];\nexport { x };");
    const program = buildProgram([file]);
    const diags = runSemanticGates(program, [file]);
    expect(codes(diags)).toContain("TS2CPP_HETEROGENEOUS_ARRAY");
  });

  it("does NOT flag [1, 2, 3] (homogeneous numeric)", () => {
    const file = writeFile("main.ts", "const x = [1, 2, 3];\nexport { x };");
    const program = buildProgram([file]);
    const diags = runSemanticGates(program, [file]);
    expect(codes(diags)).not.toContain("TS2CPP_HETEROGENEOUS_ARRAY");
  });

  it("does NOT flag [1, true] (int+bool — numeric widening is accepted, Q2)", () => {
    const file = writeFile("main.ts", "const x = [1, true];\nexport { x };");
    const program = buildProgram([file]);
    const diags = runSemanticGates(program, [file]);
    expect(codes(diags)).not.toContain("TS2CPP_HETEROGENEOUS_ARRAY");
  });

  it("flags [1, \"a\", true] (mixed numeric/string/bool)", () => {
    const file = writeFile("main.ts", "const x = [1, \"a\", true];\nexport { x };");
    const program = buildProgram([file]);
    const diags = runSemanticGates(program, [file]);
    expect(codes(diags)).toContain("TS2CPP_HETEROGENEOUS_ARRAY");
  });

  it("does NOT flag a tuple contextual type ([1, \"a\"] assigned to [number, string])", () => {
    const file = writeFile("main.ts", "const x: [number, string] = [1, \"a\"];\nexport { x };");
    const program = buildProgram([file]);
    const diags = runSemanticGates(program, [file]);
    expect(codes(diags)).not.toContain("TS2CPP_HETEROGENEOUS_ARRAY");
  });

  it("does NOT flag a tuple passed to a tuple-typed parameter", () => {
    const file = writeFile("main.ts", `
      function f(t: [number, string]): void { void t; }
      f([1, "a"]);
    `);
    const program = buildProgram([file]);
    const diags = runSemanticGates(program, [file]);
    expect(codes(diags)).not.toContain("TS2CPP_HETEROGENEOUS_ARRAY");
  });

  it("does NOT flag an array literal with any-typed elements", () => {
    // The explicit-any gate (Phase 2) flags the `any` source; the array gate
    // skips any-typed elements rather than double-reporting.
    const file = writeFile("main.ts", "const y: any = 1; const x = [1, y];\nexport { x };");
    const program = buildProgram([file]);
    const diags = runSemanticGates(program, [file]);
    expect(codes(diags)).not.toContain("TS2CPP_HETEROGENEOUS_ARRAY");
  });

  it("attaches line/column/sourceLine/hint to the diagnostic", () => {
    const file = writeFile("main.ts", "const x = [1, \"a\"];\nexport { x };");
    const program = buildProgram([file]);
    const diags = runSemanticGates(program, [file]);
    const diag = diags.find(d => d.code === "TS2CPP_HETEROGENEOUS_ARRAY");
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe("error");
    expect(diag!.line).toBe(1);
    expect(diag!.column).toBeGreaterThanOrEqual(1);
    expect(diag!.sourceLine).toContain("[");
    expect(diag!.hint).toContain("tuple");
  });

  it("flags an object mixed with primitives", () => {
    const file = writeFile("main.ts", "const x = [1, { a: 2 }];\nexport { x };");
    const program = buildProgram([file]);
    const diags = runSemanticGates(program, [file]);
    expect(codes(diags)).toContain("TS2CPP_HETEROGENEOUS_ARRAY");
  });
});

describe("semantic gates: new on interface, cross-file (TS2CPP_NEW_ON_INTERFACE)", () => {
  it("flags new on an interface defined in another file", () => {
    const iface = writeFile("iface.ts", "export interface IFoo { bar: number; }\n");
    const main = writeFile("main.ts", `
      import { IFoo } from "./iface";
      const x = new IFoo();
      export { x };
    `);
    const program = buildProgram([iface, main]);
    const diags = runSemanticGates(program, [iface, main]);
    expect(codes(diags)).toContain("TS2CPP_NEW_ON_INTERFACE");
  });

  it("does NOT flag new on a class", () => {
    const file = writeFile("main.ts", "class Foo { bar = 0; }\nconst x = new Foo();\nexport { x };");
    const program = buildProgram([file]);
    const diags = runSemanticGates(program, [file]);
    expect(codes(diags)).not.toContain("TS2CPP_NEW_ON_INTERFACE");
  });

  it("does NOT flag new on a class defined in another file", () => {
    const cls = writeFile("cls.ts", "export class Foo { bar = 0; }\n");
    const main = writeFile("main.ts", `
      import { Foo } from "./cls";
      const x = new Foo();
      export { x };
    `);
    const program = buildProgram([cls, main]);
    const diags = runSemanticGates(program, [cls, main]);
    expect(codes(diags)).not.toContain("TS2CPP_NEW_ON_INTERFACE");
  });

  it("includes the interface name in the message and hint", () => {
    const iface = writeFile("iface.ts", "export interface IFoo { bar: number; }\n");
    const main = writeFile("main.ts", `
      import { IFoo } from "./iface";
      const x = new IFoo();
      export { x };
    `);
    const program = buildProgram([iface, main]);
    const diags = runSemanticGates(program, [iface, main]);
    const diag = diags.find(d => d.code === "TS2CPP_NEW_ON_INTERFACE");
    expect(diag).toBeDefined();
    expect(diag!.message).toContain("IFoo");
    expect(diag!.hint).toContain("class");
  });
});
