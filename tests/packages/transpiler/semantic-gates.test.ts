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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "typecad-hal-semantic-"));
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
        const _log1 = "missing";
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
        const _log2 = "missing";
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
        const k: string = key;
        const v: number = value;
        void k; void v;
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

// ---------------------------------------------------------------------------
// Merged from the legacy root-level tests/semantic-gates.test.ts — direct
// single-file runSemanticGates coverage (map-copy mutation, array params,
// typed arrays, global-name collisions, Phase 3 verifier) complementing the
// cross-file suites above.
// ---------------------------------------------------------------------------

/**
 * Build a ts.Program from a single source string (with the default lib loaded
 * so Map/Set/Array/typed-arrays resolve) and run the semantic gates against it.
 * Returns the diagnostics keyed by code for easy assertion.
 */
function runGates(source: string): { byCode: Map<string, ReturnType<typeof runSemanticGates>>; all: ReturnType<typeof runSemanticGates> } {
  const fileName = "/semantic-gates-test.ts";
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const baseHost = ts.createCompilerHost({
    target: ts.ScriptTarget.ES2021,
    module: ts.ModuleKind.Node16,
    moduleResolution: ts.ModuleResolutionKind.Node10,
  }, true);
  const host: ts.CompilerHost = {
    ...baseHost,
    getSourceFile: (f, lang, onError) => {
      if (f === fileName) return sourceFile;
      return baseHost.getSourceFile(f, lang, onError);
    },
    fileExists: (f) => (f === fileName ? true : baseHost.fileExists(f)),
    readFile: (f) => (f === fileName ? source : baseHost.readFile(f)),
  };
  const program = ts.createProgram({
    rootNames: [fileName],
    options: {
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2021,
      module: ts.ModuleKind.Node16,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      types: [],
    },
    host,
  });
  // Suppress TS's own type errors from the test assertions — we only care
  // about runSemanticGates output. (The snippets below are type-correct anyway.)
  const diags = runSemanticGates(program, [fileName]);
  const byCode = new Map<string, typeof diags>();
  for (const d of diags) {
    if (!d.code) continue;
    const arr = byCode.get(d.code) ?? [];
    arr.push(d);
    byCode.set(d.code, arr);
  }
  return { byCode, all: diags };
}

/**
 * Like `runGates`, but injects extra ambient declaration files at the given
 * slash-paths (mimicking third-party `@types/*` packages or other non-user
 * program files). Used to test the `TS2CPP_GLOBAL_NAME_COLLISION` gate's
 * filtering of opted-out ambient declarations (demo #27 Finding F): the gate
 * must ignore names declared under `/node_modules/@types/` while still
 * catching DOM globals from TS's own `lib.*.d.ts` files (which live under
 * `node_modules/typescript/lib/`).
 */
function runGatesWithAmbientTypes(
  source: string,
  ambientFiles: Record<string, string>,
): { byCode: Map<string, ReturnType<typeof runSemanticGates>>; all: ReturnType<typeof runSemanticGates> } {
  const fileName = "/semantic-gates-test.ts";
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const ambientSourceFiles = new Map<string, ts.SourceFile>();
  for (const [p, content] of Object.entries(ambientFiles)) {
    ambientSourceFiles.set(p.replace(/\\/g, "/"), ts.createSourceFile(p, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
  }
  const baseHost = ts.createCompilerHost({
    target: ts.ScriptTarget.ES2021,
    module: ts.ModuleKind.Node16,
    moduleResolution: ts.ModuleResolutionKind.Node10,
  }, true);
  const host: ts.CompilerHost = {
    ...baseHost,
    getSourceFile: (f, lang, onError) => {
      const norm = f.replace(/\\/g, "/");
      if (norm === fileName) return sourceFile;
      const amb = ambientSourceFiles.get(norm);
      if (amb) return amb;
      return baseHost.getSourceFile(f, lang, onError);
    },
    fileExists: (f) => {
      const norm = f.replace(/\\/g, "/");
      if (norm === fileName) return true;
      if (ambientSourceFiles.has(norm)) return true;
      return baseHost.fileExists(f);
    },
    readFile: (f) => {
      const norm = f.replace(/\\/g, "/");
      if (norm === fileName) return source;
      const amb = ambientSourceFiles.get(norm);
      if (amb) return amb.getFullText();
      return baseHost.readFile(f);
    },
  };
  const program = ts.createProgram({
    rootNames: [fileName, ...ambientSourceFiles.keys()],
    options: {
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2021,
      module: ts.ModuleKind.Node16,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      types: [],
    },
    host,
  });
  const diags = runSemanticGates(program, [fileName]);
  const byCode = new Map<string, typeof diags>();
  for (const d of diags) {
    if (!d.code) continue;
    const arr = byCode.get(d.code) ?? [];
    arr.push(d);
    byCode.set(d.code, arr);
  }
  return { byCode, all: diags };
}

describe("runSemanticGates — TS2CPP_MAP_VALUE_COPY_MUTATION", () => {
  it("flags field assignment on a map.get(k)! copy", () => {
    const { byCode } = runGates(`
      interface Task { done: boolean; }
      function f(tasks: Map<string, Task>, id: string) {
        const task = tasks.get(id)!;
        task.done = true;
      }
    `);
    expect(byCode.get("TS2CPP_MAP_VALUE_COPY_MUTATION")?.length).toBe(1);
  });

  it("flags postfix ++ on a field of a map copy", () => {
    const { byCode } = runGates(`
      interface Counter { n: number; }
      function f(m: Map<string, Counter>, id: string) {
        const c = m.get(id)!;
        c.n++;
      }
    `);
    expect(byCode.get("TS2CPP_MAP_VALUE_COPY_MUTATION")?.length).toBe(1);
  });

  it("flags prefix -- on a field of a map copy", () => {
    const { byCode } = runGates(`
      interface Counter { n: number; }
      function f(m: Map<string, Counter>, id: string) {
        const c = m.get(id)!;
        --c.n;
      }
    `);
    expect(byCode.get("TS2CPP_MAP_VALUE_COPY_MUTATION")?.length).toBe(1);
  });

  it("flags compound assignment (+=) on a field of a map copy", () => {
    const { byCode } = runGates(`
      interface Counter { n: number; }
      function f(m: Map<string, Counter>, id: string) {
        const c = m.get(id)!;
        c.n += 1;
      }
    `);
    expect(byCode.get("TS2CPP_MAP_VALUE_COPY_MUTATION")?.length).toBe(1);
  });

  it("flags element-index assignment on a map copy (map[k])", () => {
    const { byCode } = runGates(`
      interface Bag { items: number[]; }
      function f(m: Record<string, Bag>, id: string) {
        const b = m[id];
        b.items[0] = 42;
      }
    `);
    expect(byCode.get("TS2CPP_MAP_VALUE_COPY_MUTATION")?.length).toBe(1);
  });

  it("does not flag mutation of a non-copy local", () => {
    const { byCode } = runGates(`
      interface Task { done: boolean; }
      function f() {
        const task: Task = { done: false };
        task.done = true;
      }
    `);
    expect(byCode.has("TS2CPP_MAP_VALUE_COPY_MUTATION")).toBe(false);
  });

  // ── Newly intercepted false negatives (Phase 1 motivation) ──────────────

  it("flags mutation after the binding was destructured (was a false negative)", () => {
    // Old scope machinery never registered destructuring bindings, so the
    // outer map-copy fact leaked onto the destructured name. The binding pass
    // now records origins on destructuring elements.
    const { byCode } = runGates(`
      interface Box { task: { done: boolean } }
      function f(m: Map<string, Box>, id: string) {
        const { task } = m.get(id)!;
        task.done = true;
      }
    `);
    expect(byCode.get("TS2CPP_MAP_VALUE_COPY_MUTATION")?.length).toBe(1);
  });

  it("reflects reassignment: binding reassigned to a non-copy is no longer flagged", () => {
    // Old code kept the stale map-copy origin after reassignment. The binding
    // pass recomputes on each assignment initializer.
    const { byCode } = runGates(`
      interface Task { done: boolean; }
      function f(m: Map<string, Task>, id: string, other: Task) {
        let task = m.get(id)!;
        task = other;
        task.done = true;
      }
    `);
    expect(byCode.has("TS2CPP_MAP_VALUE_COPY_MUTATION")).toBe(false);
  });

  it("reflects reassignment: binding reassigned to a map copy IS flagged", () => {
    const { byCode } = runGates(`
      interface Task { done: boolean; }
      function f(m: Map<string, Task>, id: string, placeholder: Task) {
        let task = placeholder;
        task = m.get(id)!;
        task.done = true;
      }
    `);
    expect(byCode.get("TS2CPP_MAP_VALUE_COPY_MUTATION")?.length).toBe(1);
  });

  // ── Demo #25 Finding A: class-typed map values are pointers, not value copies ──
  // A TS `class` is a reference type that lowers to a C++ pointer (C*), so a
  // `map.get(k)` returns a pointer and a field write through it persists. The
  // gate must NOT fire for class-typed entries — only for interface/struct
  // (value-typed) entries.

  it("does NOT flag field mutation on a class-typed map.get(k)! (it is a pointer, not a copy)", () => {
    const { byCode } = runGates(`
      class Entry { value: number; }
      function f(m: Map<string, Entry>, id: string) {
        const entry = m.get(id)!;
        entry.value = 42;
      }
    `);
    expect(byCode.has("TS2CPP_MAP_VALUE_COPY_MUTATION")).toBe(false);
  });

  it("does NOT flag postfix ++ on a class-typed map.get(k)! field (pointer)", () => {
    const { byCode } = runGates(`
      class Counter { n: number; }
      function f(m: Map<string, Counter>, id: string) {
        const c = m.get(id)!;
        c.n++;
      }
    `);
    expect(byCode.has("TS2CPP_MAP_VALUE_COPY_MUTATION")).toBe(false);
  });

  it("does NOT flag compound assignment on a class-typed map.get(k)! field (pointer)", () => {
    const { byCode } = runGates(`
      class Counter { n: number; }
      function f(m: Map<string, Counter>, id: string) {
        const c = m.get(id)!;
        c.n += 1;
      }
    `);
    expect(byCode.has("TS2CPP_MAP_VALUE_COPY_MUTATION")).toBe(false);
  });

  it("does NOT flag mutation after reassignment to a class-typed map.get(k)!", () => {
    const { byCode } = runGates(`
      class Entry { value: number; }
      function f(m: Map<string, Entry>, id: string, placeholder: Entry) {
        let entry = placeholder;
        entry = m.get(id)!;
        entry.value = 7;
      }
    `);
    expect(byCode.has("TS2CPP_MAP_VALUE_COPY_MUTATION")).toBe(false);
  });

  it("still flags an interface-typed map.get(k)! copy when a class of the same shape exists elsewhere", () => {
    // Guard against the exemption being too broad: an interface value IS a copy
    // even if a structurally-identical class exists in the program.
    const { byCode } = runGates(`
      class Counter { n: number; }
      interface ICounter { n: number; }
      function f(m: Map<string, ICounter>, id: string) {
        const c = m.get(id)!;
        c.n = 9;
      }
    `);
    expect(byCode.get("TS2CPP_MAP_VALUE_COPY_MUTATION")?.length).toBe(1);
  });
});

describe("runSemanticGates — TS2CPP_ARRAY_PARAM_MUTATION", () => {
  it("flags field/index assignment through an array parameter", () => {
    const { byCode } = runGates(`
      function f(arr: number[]) {
        arr[0] = 1;
      }
    `);
    expect(byCode.get("TS2CPP_ARRAY_PARAM_MUTATION")?.length).toBe(1);
  });

  it("flags a mutating method call (.push) on an array parameter", () => {
    const { byCode } = runGates(`
      function f(arr: number[]) {
        arr.push(1);
      }
    `);
    expect(byCode.get("TS2CPP_ARRAY_PARAM_MUTATION")?.length).toBe(1);
  });

  it("does not flag mutation of a local array", () => {
    const { byCode } = runGates(`
      function f() {
        const arr: number[] = [1, 2];
        arr.push(3);
      }
    `);
    expect(byCode.has("TS2CPP_ARRAY_PARAM_MUTATION")).toBe(false);
  });
});

describe("runSemanticGates — TS2CPP_TYPED_ARRAY_PARAM_LENGTH", () => {
  it("flags .length on a typed-array parameter", () => {
    const { byCode } = runGates(`
      function f(buf: Uint8Array) {
        return buf.length;
      }
    `);
    expect(byCode.get("TS2CPP_TYPED_ARRAY_PARAM_LENGTH")?.length).toBe(1);
  });

  it("does not flag .length on a local typed array", () => {
    const { byCode } = runGates(`
      function f() {
        const buf = new Uint8Array(4);
        return buf.length;
      }
    `);
    expect(byCode.has("TS2CPP_TYPED_ARRAY_PARAM_LENGTH")).toBe(false);
  });
});

describe("runSemanticGates — TS2CPP_TYPED_ARRAY_FIELD", () => {
  it("flags a typed-array class field (Uint8Array)", () => {
    const { byCode } = runGates(`
      class C {
        private buf: Uint8Array = new Uint8Array(0);
      }
    `);
    expect(byCode.get("TS2CPP_TYPED_ARRAY_FIELD")?.length).toBe(1);
  });

  it("flags a typed-array field regardless of initializer", () => {
    const { byCode } = runGates(`
      class C {
        buf: Float32Array = new Float32Array([1, 2, 3]);
      }
    `);
    expect(byCode.get("TS2CPP_TYPED_ARRAY_FIELD")?.length).toBe(1);
  });

  it("does not flag a plain-array (number[]) field", () => {
    const { byCode } = runGates(`
      class C {
        private scores: number[] = [];
      }
    `);
    expect(byCode.has("TS2CPP_TYPED_ARRAY_FIELD")).toBe(false);
  });

  it("does not flag a function-local typed array", () => {
    const { byCode } = runGates(`
      function f() {
        const buf = new Uint8Array(8);
        return buf[0];
      }
    `);
    expect(byCode.has("TS2CPP_TYPED_ARRAY_FIELD")).toBe(false);
  });
});

describe("runSemanticGates — clean code produces no diagnostics", () => {
  it("passes a simple function with no container hazards", () => {
    const { all } = runGates(`
      function f(x: number, y: number): number {
        return x + y;
      }
    `);
    // The clean-code expectation excludes the DOM-lib name-collision check,
    // which has nothing to flag here.
    const nonCollision = all.filter((d) => d.code !== "TS2CPP_GLOBAL_NAME_COLLISION");
    expect(nonCollision.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Demo #25 Finding B — global name collision.
// A user class/interface/enum/type alias whose name matches a global type from
// a lib (the DOM `Node`, `Element`, `Event`, ...) is shadowed at every use
// site, producing a cascade of spurious TS errors. The check surfaces one clear
// diagnostic per colliding declaration.
// ---------------------------------------------------------------------------
describe("runSemanticGates — TS2CPP_GLOBAL_NAME_COLLISION", () => {
  it("flags a class named like a DOM global (Node)", () => {
    const { byCode } = runGates(`
      class Node {
        value: number;
      }
    `);
    expect(byCode.get("TS2CPP_GLOBAL_NAME_COLLISION")?.length).toBe(1);
  });

  it("flags an interface named like a DOM global (Element)", () => {
    const { byCode } = runGates(`
      interface Element {
        tag: string;
      }
    `);
    expect(byCode.get("TS2CPP_GLOBAL_NAME_COLLISION")?.length).toBe(1);
  });

  it("flags an enum named like a DOM global (Event)", () => {
    const { byCode } = runGates(`
      enum Event { A, B }
    `);
    expect(byCode.get("TS2CPP_GLOBAL_NAME_COLLISION")?.length).toBe(1);
  });

  it("does NOT flag a class whose name is not a global", () => {
    const { byCode } = runGates(`
      class MyEntry {
        value: number;
      }
    `);
    expect(byCode.has("TS2CPP_GLOBAL_NAME_COLLISION")).toBe(false);
  });

  it("reports a colliding name only once per file", () => {
    const { byCode } = runGates(`
      class Node { a: number; }
      class Node { b: number; }
    `);
    // Two declarations of the same colliding name in one file → a single
    // diagnostic (deduplicated by file:name) pointing at the first.
    expect(byCode.get("TS2CPP_GLOBAL_NAME_COLLISION")?.length).toBe(1);
  });

  // Demo #27 Finding F — the gate previously walked EVERY non-user program
  // file for declared names, so a third-party `@types/*` package pulled into
  // the TS Program from the repo-root `node_modules` (e.g. `@types/node`,
  // which is loaded even when the user's tsconfig sets `"types": []`) leaked
  // common short names (`Mode`, `CipherMode`, `Direction`, ...) into the
  // globals set and false-tripped the gate on idiomatic user enums. The fix
  // excludes `/node_modules/@types/` (but NOT all of `node_modules` — TS's own
  // `lib.*.d.ts` files live under `node_modules/typescript/lib/` and define
  // the DOM globals the gate exists to catch).
  it("does NOT flag a user enum whose name matches an @types/node global (demo #27 Finding F)", () => {
    const { byCode } = runGatesWithAmbientTypes(
      // User code: an idiomatic short-named enum. `Mode` is declared in
      // @types/node, so before the fix this tripped the gate.
      `const enum Mode { Read = 0, Write = 1 }`,
      // A synthetic ambient declaration mimicking @types/node/crypto.d.ts,
      // placed under an absolute node_modules/@types/ path (as TS resolves it
      // in practice from the repo-root node_modules) so the fix's filter
      // excludes it from the globals set.
      {
        "/project/node_modules/@types/node/crypto.d.ts": `type Mode = number; type CipherMode = number;`,
      },
    );
    expect(byCode.has("TS2CPP_GLOBAL_NAME_COLLISION")).toBe(false);
  });

  it("still flags a user class matching a DOM lib global when @types is also present (lib.* not excluded)", () => {
    // Regression guard: the fix excludes only @types/*, not TS's own lib files.
    // `Element` comes from lib.dom.d.ts (under node_modules/typescript/lib/),
    // so a user `class Element` must STILL trip the gate even when an
    // unrelated @types package is loaded.
    const { byCode } = runGatesWithAmbientTypes(
      `class Element { tag: string; }`,
      {
        "/project/node_modules/@types/node/crypto.d.ts": `type Mode = number;`,
      },
    );
    expect(byCode.get("TS2CPP_GLOBAL_NAME_COLLISION")?.length).toBe(1);
  });
});

describe("runSemanticGates — Phase 3 fact-completeness verifier", () => {
  // The verifier (semantic-facts-verifier.ts) walks every expression and emits
  // TS2CPP_UNCLASSIFIABLE_TYPE for any whose canonical type is "unknown". It
  // runs inside runSemanticGates at "warning" severity by default. `any` is
  // NOT flagged (it has its own canonical category) — only genuinely
  // unclassifiable types are.

  it("does not flag clean, fully-typed code", () => {
    const { byCode } = runGates(`
      function f(x: number): number {
        const y = x * 2;
        return y + 1;
      }
    `);
    expect(byCode.has("TS2CPP_UNCLASSIFIABLE_TYPE")).toBe(false);
  });

  it("does NOT flag any-typed expressions (any is a non-hazard category)", () => {
    // `any` is the transpiler's legitimate inference path — the verifier must
    // not flood builds that use untyped code.
    const { byCode } = runGates(`
      function f(a: any): any {
        return a + 1;
      }
    `);
    expect(byCode.has("TS2CPP_UNCLASSIFIABLE_TYPE")).toBe(false);
  });

  it("does NOT flag a same-kind string-literal union (lowers to a single std::string)", () => {
    // A pure string-literal union `type Status = "ok" | "err"` lowers to a
    // single `std::string` (string unions are a recommended alternative to
    // keyof). All constituents canonicalize to the
    // same "primitive" category, so the union coalesces and must NOT trip the
    // unclassifiable warning. Demo #22 Finding C.
    const { byCode } = runGates(`
      type Status = "ok" | "err";
      function f(s: Status): Status {
        return s;
      }
    `);
    expect(byCode.has("TS2CPP_UNCLASSIFIABLE_TYPE")).toBe(false);
  });

  it("does NOT flag a narrowed enum-member union (coalesces to the enum)", () => {
    // After `if (t.kind === K.A) { ... }`, TypeScript narrows `t.kind` to
    // `K.B | K.C`. Every constituent is an EnumLiteral of the same enum, which
    // lowers to a single integral type (compared via static_cast<int>). The
    // union coalesces to "primitive" and must NOT warn. Demo #22 Finding C.
    const { byCode } = runGates(`
      const enum K { A = 0, B = 1, C = 2 }
      interface T { kind: K; }
      function f(t: T): boolean {
        if (t.kind === K.A) return false;
        // here t.kind is narrowed to K.B | K.C
        return t.kind === K.B;
      }
    `);
    expect(byCode.has("TS2CPP_UNCLASSIFIABLE_TYPE")).toBe(false);
  });

  it("does NOT flag a bare Shared/Mutable borrow (unknown by design)", () => {
    // `const ref: Shared = src` is the exact form the ownership diagnostics
    // recommend. The alias is transparent (`type Shared<T = unknown> = T`), so
    // the variable IS TS-unknown — but the lowering resolves the type through
    // the borrow source, never from the annotation. Flagging it would warn
    // about the engine's own suggested fix (same for parameter borrows). Bare
    // `Owned` owns storage and still needs a concrete type — it stays flagged.
    const borrowFile = `
      type Shared<T = unknown> = T;
      type Mutable<T = unknown> = T;
      let src = new Uint8Array(8);
      const ref: Shared = src;
      function takes(m: Mutable): number { return 0; }
      export { ref, takes };
    `;
    expect(runGates(borrowFile).byCode.has("TS2CPP_UNCLASSIFIABLE_TYPE")).toBe(false);
  });

  it("flags a bare Owned declaration (owned storage needs a concrete type)", () => {
    // src is a known typed array; `owned` is unknown ONLY through the bare
    // Owned annotation — the exemption must not cover it.
    const ownedFile = `
      type Owned<T = unknown> = T;
      let src = new Uint8Array(8);
      const owned: Owned = src;
      export { owned };
    `;
    expect(runGates(ownedFile).byCode.has("TS2CPP_UNCLASSIFIABLE_TYPE")).toBe(true);
  });

  it("flags a heterogeneous union (primitive | struct) as unclassifiable", () => {
    // A union whose constituents canonicalize to DIFFERENT categories does
    // not coalesce and remains a genuine hazard — the transpiler cannot pick
    // one C++ type. Here number (primitive) | Point (struct) mix categories.
    const { byCode, all } = runGates(`
      interface Point { x: number; y: number; }
      type Mixed = number | Point;
      function f(m: Mixed): Mixed {
        return m;
      }
    `);
    const unclassified = all.filter((d) => d.code === "TS2CPP_UNCLASSIFIABLE_TYPE");
    expect(unclassified.length).toBeGreaterThan(0);
    // Default severity is warning, not error.
    expect(unclassified.every((d) => d.severity === "warning")).toBe(true);
  });

  it("does not flag `this` types or nullable unions", () => {
    // Both were canonicalize gaps before Phase 3; now classified (this ->
    // struct via constraint, Account | null -> struct via null-stripping).
    const { byCode } = runGates(`
      class Account { id: number = 0; }
      function find(id: number): Account | null { return null; }
      class Service {
        cache: Map<number, Account> = new Map();
        get(id: number): Account | null {
          const a = this.cache.get(id) ?? null;
          return a;
        }
      }
    `);
    expect(byCode.has("TS2CPP_UNCLASSIFIABLE_TYPE")).toBe(false);
  });
});
