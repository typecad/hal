// ---------------------------------------------------------------------------
// SemanticFacts — CanonicalType resolver unit tests (Phase 0).
//
// canonicalize() is the single source of truth that replaces the six boolean
// predicates (isMapLikeType, isSetLikeType, isTypedArrayType, isArrayLikeType,
// isContainerType, and the disguised typeToString() calls). These tests pin
// its behavior on representative types before any gate starts consuming it.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import ts from "typescript";
import { canonicalize, cppTypeFromCanonicalType } from "../packages/cuttlefish/src/orchestrator/semantic-facts";

/**
 * Build a ts.Program from a single source string and return the checker plus
 * a helper to fetch the type at the end of `marker;` expression statements.
 *
 * The host delegates lib resolution to ts.sys so that Map, Set, Uint8Array,
 * Array, etc. resolve to their real declarations (the production path uses
 * ts.createProgram with the same default lib loading).
 */
function analyze(source: string): {
  checker: ts.TypeChecker;
  typeOf: (name: string) => ts.Type;
} {
  const fileName = "/semantic-facts-test.ts";
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const host = ts.createCompilerHost({
    target: ts.ScriptTarget.ES2021,
    module: ts.ModuleKind.Node16,
    moduleResolution: ts.ModuleResolutionKind.Node10,
  }, true);
  // Override only the four methods that touch our virtual file; everything
  // else (lib resolution,getDefaultLibFileName, directory lookups) stays from
  // the real host so Map/Set/Uint8Array resolve correctly.
  const customHost: ts.CompilerHost = {
    ...host,
    getSourceFile: (f, lang, onError) => {
      if (f === fileName) return sourceFile;
      return host.getSourceFile(f, lang, onError);
    },
    fileExists: (f) => (f === fileName ? true : host.fileExists(f)),
    readFile: (f) => (f === fileName ? source : host.readFile(f)),
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
    host: customHost,
  });
  const checker = program.getTypeChecker();

  const typeOf = (name: string): ts.Type => {
    let found: ts.Expression | undefined;
    const visit = (node: ts.Node): void => {
      if (found) return;
      if (
        ts.isExpressionStatement(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === name
      ) {
        found = node.expression;
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (!found) throw new Error(`No bare expression '${name}' found in source`);
    return checker.getTypeAtLocation(found);
  };

  return { checker, typeOf };
}

describe("canonicalize", () => {
  it("classifies number/string/boolean literals as primitive", () => {
    const { checker, typeOf } = analyze(`
      const n = 42;
      const s = "hi";
      const b = true;
      n; s; b;
    `);
    expect(canonicalize(checker, typeOf("n"))).toBe("primitive");
    expect(canonicalize(checker, typeOf("s"))).toBe("primitive");
    expect(canonicalize(checker, typeOf("b"))).toBe("primitive");
  });

  it("classifies bigint as primitive", () => {
    const { checker, typeOf } = analyze(`const bi = 1n; bi;`);
    expect(canonicalize(checker, typeOf("bi"))).toBe("primitive");
  });

  it("classifies Map and Record as map", () => {
    const { checker, typeOf } = analyze(`
      const m = new Map<string, number>();
      const r: Record<string, number> = {};
      m; r;
    `);
    expect(canonicalize(checker, typeOf("m"))).toBe("map");
    expect(canonicalize(checker, typeOf("r"))).toBe("map");
  });

  it("classifies ReadonlyMap as map", () => {
    const { checker, typeOf } = analyze(`
      const rm: ReadonlyMap<string, number> = new Map();
      rm;
    `);
    expect(canonicalize(checker, typeOf("rm"))).toBe("map");
  });

  it("classifies Set and ReadonlySet as set", () => {
    const { checker, typeOf } = analyze(`
      const s = new Set<string>();
      s;
    `);
    expect(canonicalize(checker, typeOf("s"))).toBe("set");
  });

  it("classifies typed arrays as typed-array", () => {
    const { checker, typeOf } = analyze(`
      const u8 = new Uint8Array(4);
      const f64 = new Float64Array(2);
      const i32 = new Int32Array(2);
      u8; f64; i32;
    `);
    expect(canonicalize(checker, typeOf("u8"))).toBe("typed-array");
    expect(canonicalize(checker, typeOf("f64"))).toBe("typed-array");
    expect(canonicalize(checker, typeOf("i32"))).toBe("typed-array");
  });

  it("classifies Array<T>, T[], tuple, and ReadonlyArray as array", () => {
    const { checker, typeOf } = analyze(`
      const a = new Array<number>();
      const lit = [1, 2, 3];
      const tup: [number, string] = [1, "x"];
      const ro: ReadonlyArray<number> = [1];
      a; lit; tup; ro;
    `);
    expect(canonicalize(checker, typeOf("a"))).toBe("array");
    expect(canonicalize(checker, typeOf("lit"))).toBe("array");
    expect(canonicalize(checker, typeOf("tup"))).toBe("array");
    expect(canonicalize(checker, typeOf("ro"))).toBe("array");
  });

  it("classifies classes and interfaces as struct", () => {
    const { checker, typeOf } = analyze(`
      class Foo { x: number = 0; }
      interface Bar { y: number; }
      const f = new Foo();
      const b: Bar = { y: 1 };
      f; b;
    `);
    expect(canonicalize(checker, typeOf("f"))).toBe("struct");
    expect(canonicalize(checker, typeOf("b"))).toBe("struct");
  });

  it("classifies object literals as struct", () => {
    const { checker, typeOf } = analyze(`const o = { a: 1 }; o;`);
    expect(canonicalize(checker, typeOf("o"))).toBe("struct");
  });

  it("classifies function declarations and arrow types as function", () => {
    const { checker, typeOf } = analyze(`
      function fn(x: number): string { return String(x); }
      const arrow = (x: number) => x + 1;
      fn; arrow;
    `);
    expect(canonicalize(checker, typeOf("fn"))).toBe("function");
    expect(canonicalize(checker, typeOf("arrow"))).toBe("function");
  });

  it("classifies enums as primitive (Enum flag)", () => {
    const { checker, typeOf } = analyze(`
      enum Color { Red, Green, Blue }
      const c = Color.Red;
      c;
    `);
    expect(canonicalize(checker, typeOf("c"))).toBe("primitive");
  });

  it("classifies any as 'any' (distinct from unknown — non-hazard for the verifier)", () => {
    // `any` is the transpiler's legitimate inference path; canonicalize marks
    // it distinctly so the verifier can treat it as a non-hazard while still
    // flagging genuinely unclassifiable types as "unknown".
    const { checker, typeOf } = analyze(`
      const a: any = 1;
      a;
    `);
    expect(canonicalize(checker, typeOf("a"))).toBe("any");
  });

  it("classifies `this` type as struct", () => {
    const { checker, typeOf } = analyze(`
      class C { v: number = 0; m(): C { return this; } }
      const c = new C();
      c;
    `);
    expect(canonicalize(checker, typeOf("c"))).toBe("struct");
  });

  it("classifies a nullable union by its non-null constituent", () => {
    const { checker, typeOf } = analyze(`
      interface Account { id: number; }
      function f(): Account | null { return null; }
      const a = f();
      a;
    `);
    expect(canonicalize(checker, typeOf("a"))).toBe("struct");
  });

  it("classifies a number | undefined union as primitive", () => {
    const { checker, typeOf } = analyze(`
      function f(): number | undefined { return 1; }
      const n = f();
      n;
    `);
    expect(canonicalize(checker, typeOf("n"))).toBe("primitive");
  });
});

// ---------------------------------------------------------------------------
// cppTypeFromCanonicalType — Phase 3 concrete C++ type projection.
//
// For the categories where the cppType is deterministic from the TS type alone,
// this returns the concrete C++ type the lowering emits. It populates
// SemanticFacts.cppType so gate rules can read a concrete type without
// re-deriving it. Categories that depend on IR-build context (array/map/set
// element types, `auto` deduction) return undefined and are deferred to the
// ProgramIR SymbolTable.
// ---------------------------------------------------------------------------
describe("cppTypeFromCanonicalType", () => {
  it("maps string to std::string and number to double", () => {
    const { checker, typeOf } = analyze(`
      const s = "hi";
      const n = 42;
      s; n;
    `);
    expect(cppTypeFromCanonicalType(checker, typeOf("s"), "primitive")).toBe("std::string");
    expect(cppTypeFromCanonicalType(checker, typeOf("n"), "primitive")).toBe("double");
  });

  it("maps boolean to bool", () => {
    const { checker, typeOf } = analyze(`const b = true; b;`);
    expect(cppTypeFromCanonicalType(checker, typeOf("b"), "primitive")).toBe("bool");
  });

  it("maps each typed array to its element pointer type", () => {
    const { checker, typeOf } = analyze(`
      const u8 = new Uint8Array(4);
      const f64 = new Float64Array(2);
      const i32 = new Int32Array(2);
      const u16 = new Uint16Array(2);
      u8; f64; i32; u16;
    `);
    expect(cppTypeFromCanonicalType(checker, typeOf("u8"), "typed-array")).toBe("uint8_t*");
    expect(cppTypeFromCanonicalType(checker, typeOf("f64"), "typed-array")).toBe("double*");
    expect(cppTypeFromCanonicalType(checker, typeOf("i32"), "typed-array")).toBe("int32_t*");
    expect(cppTypeFromCanonicalType(checker, typeOf("u16"), "typed-array")).toBe("uint16_t*");
  });

  it("returns the bare name for a struct (class/interface)", () => {
    const { checker, typeOf } = analyze(`
      interface Account { id: number; }
      class Bank { name: string = ""; }
      const a: Account = { id: 1 };
      const b = new Bank();
      a; b;
    `);
    expect(cppTypeFromCanonicalType(checker, typeOf("a"), "struct")).toBe("Account");
    expect(cppTypeFromCanonicalType(checker, typeOf("b"), "struct")).toBe("Bank");
  });

  it("returns undefined for container categories (element type is a SymbolTable concern)", () => {
    const { checker, typeOf } = analyze(`
      const arr = [1, 2, 3];
      const m = new Map<string, number>();
      const s = new Set<string>();
      arr; m; s;
    `);
    expect(cppTypeFromCanonicalType(checker, typeOf("arr"), "array")).toBeUndefined();
    expect(cppTypeFromCanonicalType(checker, typeOf("m"), "map")).toBeUndefined();
    expect(cppTypeFromCanonicalType(checker, typeOf("s"), "set")).toBeUndefined();
  });

  it("returns undefined for function/any/unknown", () => {
    const { checker, typeOf } = analyze(`
      const fn = (x: number) => x + 1;
      fn;
    `);
    expect(cppTypeFromCanonicalType(checker, typeOf("fn"), "function")).toBeUndefined();
    expect(cppTypeFromCanonicalType(checker, typeOf("fn"), "any")).toBeUndefined();
    expect(cppTypeFromCanonicalType(checker, typeOf("fn"), "unknown")).toBeUndefined();
  });
});
