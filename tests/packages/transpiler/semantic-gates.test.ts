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

describe("semantic gates: deterministic transpiler subset", () => {
  it("flags mutating a struct copy fetched from Map.get()", () => {
    const file = writeFile("main.ts", `
      interface Task { done: boolean; }
      const tasks = new Map<string, Task>();
      const task = tasks.get("a")!;
      task.done = true;
    `);
    const program = buildProgram([file]);
    const diags = runSemanticGates(program, [file]);
    expect(codes(diags)).toContain("TS2CPP_MAP_VALUE_COPY_MUTATION");
  });

  it("does NOT flag primitive values fetched from Map.get()", () => {
    const file = writeFile("main.ts", `
      const counts = new Map<string, number>();
      const count = counts.get("a")!;
      const next = count + 1;
      export { next };
    `);
    const program = buildProgram([file]);
    const diags = runSemanticGates(program, [file]);
    expect(codes(diags)).not.toContain("TS2CPP_MAP_VALUE_COPY_MUTATION");
  });

  it("flags nullish comparisons on Map.get()", () => {
    const file = writeFile("main.ts", `
      const counts = new Map<string, number>();
      if (counts.get("a") === undefined) {
        console.log("missing");
      }
    `);
    const program = buildProgram([file]);
    const diags = runSemanticGates(program, [file]);
    expect(codes(diags)).toContain("TS2CPP_GET_NULLISH_COMPARE");
  });

  it("flags nullish comparisons on optional struct fields", () => {
    const file = writeFile("main.ts", `
      interface User { name?: string; }
      const user: User = {};
      if (user.name === undefined) {
        console.log("missing");
      }
    `);
    const program = buildProgram([file]);
    const diags = runSemanticGates(program, [file]);
    expect(codes(diags)).toContain("TS2CPP_OPTIONAL_FIELD_NULLISH");
  });

  it("flags .length on typed-array parameters", () => {
    const file = writeFile("main.ts", `
      function size(data: Uint8Array): number {
        return data.length;
      }
      export { size };
    `);
    const program = buildProgram([file]);
    const diags = runSemanticGates(program, [file]);
    expect(codes(diags)).toContain("TS2CPP_TYPED_ARRAY_PARAM_LENGTH");
  });

  it("does NOT flag .length on a local typed array", () => {
    const file = writeFile("main.ts", `
      const data = new Uint8Array([1, 2, 3]);
      const n = data.length;
      export { n };
    `);
    const program = buildProgram([file]);
    const diags = runSemanticGates(program, [file]);
    expect(codes(diags)).not.toContain("TS2CPP_TYPED_ARRAY_PARAM_LENGTH");
  });

  it("flags typed-array returns", () => {
    const file = writeFile("main.ts", `
      function makeBuffer(): Uint8Array {
        return new Uint8Array(4);
      }
      export { makeBuffer };
    `);
    const program = buildProgram([file]);
    const diags = runSemanticGates(program, [file]);
    expect(codes(diags)).toContain("TS2CPP_TYPED_ARRAY_RETURN");
  });

  it("flags dynamic string-key access on non-map values", () => {
    const file = writeFile("main.ts", `
      interface User { name: string; }
      const user: User = { name: "Ada" };
      const key = "name";
      const value = user[key];
      export { value };
    `);
    const program = buildProgram([file]);
    const diags = runSemanticGates(program, [file]);
    expect(codes(diags)).toContain("TS2CPP_DYNAMIC_OBJECT_KEY");
  });

  it("does NOT flag numeric indexing into arrays", () => {
    const file = writeFile("main.ts", `
      const values = [1, 2, 3];
      const value = values[0];
      export { value };
    `);
    const program = buildProgram([file]);
    const diags = runSemanticGates(program, [file]);
    expect(codes(diags)).not.toContain("TS2CPP_DYNAMIC_OBJECT_KEY");
  });

  it("flags content mutation of array parameters", () => {
    const file = writeFile("main.ts", `
      function update(values: number[]): void {
        values[0] = 1;
        values.push(2);
      }
      export { update };
    `);
    const program = buildProgram([file]);
    const diags = runSemanticGates(program, [file]);
    expect(codes(diags)).toContain("TS2CPP_ARRAY_PARAM_MUTATION");
  });

  it("flags functional methods on Map/Set/Record containers", () => {
    const file = writeFile("main.ts", `
      const counts = new Map<string, number>();
      counts.forEach((value, key) => {
        console.log(key, value);
      });
    `);
    const program = buildProgram([file]);
    const diags = runSemanticGates(program, [file]);
    expect(codes(diags)).toContain("TS2CPP_CONTAINER_FUNCTIONAL_METHOD");
  });

  it("flags callbacks inside class methods when they capture this or locals", () => {
    const file = writeFile("main.ts", `
      class Accumulator {
        scale = 2;
        total(values: number[]): number {
          return values.map(value => value * this.scale).reduce((a, b) => a + b, 0);
        }
      }
      export { Accumulator };
    `);
    const program = buildProgram([file]);
    const diags = runSemanticGates(program, [file]);
    expect(codes(diags)).toContain("TS2CPP_CALLBACK_CAPTURE_UNSUPPORTED");
  });

  it("does NOT flag non-capturing callbacks inside class methods", () => {
    const file = writeFile("main.ts", `
      class Doubler {
        values(input: number[]): number[] {
          return input.map(value => value * 2);
        }
      }
      export { Doubler };
    `);
    const program = buildProgram([file]);
    const diags = runSemanticGates(program, [file]);
    expect(codes(diags)).not.toContain("TS2CPP_CALLBACK_CAPTURE_UNSUPPORTED");
  });
});
