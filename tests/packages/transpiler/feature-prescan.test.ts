// ---------------------------------------------------------------------------
// Tests for the Phase 2 syntactic feature-prescan gates:
//   - TS2CPP_EXPLICIT_ANY  (AnyKeyword)
//   - TS2CPP_NEW_ON_INTERFACE (syntactic single-file heuristic)
//
// prescanUnsupportedFeatures walks every node and emits Diagnostic[] for
// entries in KIND_REGISTRY plus checkContextSensitive matches. These tests
// exercise the new gates directly without invoking the full transpile pipeline.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import ts from "typescript";
import { prescanUnsupportedFeatures } from "@typecad/cuttlefish/testing";

function prescan(sourceText: string) {
  const sourceFile = ts.createSourceFile(
    "test.ts",
    sourceText,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );
  return prescanUnsupportedFeatures(sourceFile, sourceText);
}

function codes(diagnostics: { code?: string }[]): string[] {
  return diagnostics.map(d => d.code).filter((c): c is string => Boolean(c));
}

describe("feature-prescan: explicit any (TS2CPP_EXPLICIT_ANY)", () => {
  it("flags explicit any on a variable", () => {
    const diags = prescan("const x: any = 1;");
    expect(codes(diags)).toContain("TS2CPP_EXPLICIT_ANY");
  });

  it("flags explicit any on a parameter", () => {
    const diags = prescan("function f(x: any): void { console.log(x); }");
    expect(codes(diags)).toContain("TS2CPP_EXPLICIT_ANY");
  });

  it("flags explicit any as a return type", () => {
    const diags = prescan("function f(): any { return 1; }");
    expect(codes(diags)).toContain("TS2CPP_EXPLICIT_ANY");
  });

  it("does not flag code without any", () => {
    const diags = prescan("const x: number = 1;\nfunction f(y: string): void {}");
    expect(codes(diags)).not.toContain("TS2CPP_EXPLICIT_ANY");
  });

  it("attaches line/column/sourceLine", () => {
    const diags = prescan("const x: any = 1;");
    const anyDiag = diags.find(d => d.code === "TS2CPP_EXPLICIT_ANY");
    expect(anyDiag).toBeDefined();
    expect(anyDiag!.line).toBe(1);
    expect(anyDiag!.column).toBeGreaterThanOrEqual(1);
    expect(anyDiag!.sourceLine).toContain("any");
  });
});

describe("feature-prescan: new on interface (TS2CPP_NEW_ON_INTERFACE)", () => {
  it("flags new on an interface declared in the same file", () => {
    const diags = prescan(`
      interface IFoo { bar: number; }
      const x = new IFoo();
    `);
    expect(codes(diags)).toContain("TS2CPP_NEW_ON_INTERFACE");
  });

  it("does not flag new on a class", () => {
    const diags = prescan(`
      class Foo { bar: number = 0; }
      const x = new Foo();
    `);
    expect(codes(diags)).not.toContain("TS2CPP_NEW_ON_INTERFACE");
  });

  it("does not flag new on an unknown identifier", () => {
    // Identifier does not resolve to any interface in this file -> Phase 2
    // leaves it alone (Phase 3's TypeChecker pass would catch cross-file cases).
    const diags = prescan("const x = new Unknown();");
    expect(codes(diags)).not.toContain("TS2CPP_NEW_ON_INTERFACE");
  });

  it("attaches a hint pointing to the class fix", () => {
    const diags = prescan(`
      interface IFoo { bar: number; }
      const x = new IFoo();
    `);
    const diag = diags.find(d => d.code === "TS2CPP_NEW_ON_INTERFACE");
    expect(diag).toBeDefined();
    expect(diag!.message).toContain("IFoo");
    expect(diag!.hint).toContain("class");
  });
});

describe("feature-prescan: supported tuple annotations", () => {
  it("does not flag a tuple type annotation", () => {
    // Heterogeneous tuples are intentionally supported (std::tuple). The
    // heterogeneous-array gate (Phase 3) targets array *literals*, not tuple
    // type annotations.
    const diags = prescan("const x: [number, string] = [1, \"a\"];");
    expect(codes(diags)).not.toContain("TS2CPP_HETEROGENEOUS_ARRAY");
  });
});
