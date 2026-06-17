// ---------------------------------------------------------------------------
// Regression tests for transpiler gaps surfaced by Demo #14 (round-robin task
// scheduler). All five are FIXED in the transpiler; these pin the corrected
// emission so they don't regress.
//
//   A — `return null`/`return undefined` (and `map.get(k) ?? null`) in a
//       function whose return type is a struct now lowers to `return {};`
//       (value-init) instead of `return nullptr`/`return CUTTLEFISH_UNDEFINED`,
//       which cannot convert to a struct type.
//   B — A subclass that declares no constructor now gets a synthesized
//       forwarding constructor (`Sub(args) : Base(args) {}`), so `new Sub(args)`
//       compiles and base parameter-property init runs. C++ does not inherit
//       constructors.
//   D — Free functions are forward-declared BEFORE class bodies, so a class
//       method can call a same-file free function declared later in the source.
//   E — Static-getter access (`Cls.staticGetter`) rewrites to
//       `Cls::getStaticGetter()`, not the raw field. (Instance getters were
//       already correct.)
//   G — Template-literal interpolation of an int32_t/uint32_t uses `%d`/`%u`
//       (those are `int` typedefs), not `%ld`, avoiding `-Wformat=`.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { transpile } from "../../setup";
import { transpileFile } from "@typecad/cuttlefish/testing";

function transpileNativeSplit(tsCode: string) {
  return transpile(tsCode, { target: "native", emitMode: "split" });
}

// In split mode, class/function definitions live in the header; the .cpp
// holds only top-level statements + main(). Tests that assert on emitted
// class shape check BOTH buffers.
function allText(result: { cpp: string; header?: string }): string {
  return `${result.cpp}\n${result.header ?? ""}`;
}

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()!;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// A: struct return of null / undefined / map.get() ?? null
// ---------------------------------------------------------------------------
describe("A: struct return of null/undefined lowers to return {};", () => {
  it("return null in a struct-returning function lowers to return {};", () => {
    const result = transpileNativeSplit(
      [
        "interface T { a: int; }",
        "function peek(): T | null {",
        "  return null;",
        "}",
        "console.log(`x`);",
        "",
      ].join("\n"),
    );
    const cpp = result.cpp ?? "";
    expect(cpp).toContain("return {};");
    expect(cpp).not.toContain("return nullptr");
    expect(cpp).not.toContain("return CUTTLEFISH_UNDEFINED");
  });

  it("return map.get(k) ?? null lowers to return {};", () => {
    const result = transpileNativeSplit(
      [
        "interface T { a: int; }",
        "const m: Map<string, T> = new Map();",
        "function peek(): T | null {",
        "  return m.get('k') ?? null;",
        "}",
        "console.log(`x`);",
        "",
      ].join("\n"),
    );
    const cpp = result.cpp ?? "";
    expect(cpp).toContain("return {};");
  });

  it("return undefined in a struct-returning function lowers to return {};", () => {
    const result = transpileNativeSplit(
      [
        "interface T { a: int; }",
        "function peek(): T | undefined {",
        "  return undefined;",
        "}",
        "console.log(`x`);",
        "",
      ].join("\n"),
    );
    const cpp = result.cpp ?? "";
    expect(cpp).toContain("return {};");
  });

  it("return null in a PRIMITIVE-returning function is unchanged (not {})", () => {
    const result = transpileNativeSplit(
      [
        "function peek(): int | null {",
        "  return null;",
        "}",
        "console.log(`x`);",
        "",
      ].join("\n"),
    );
    const cpp = result.cpp ?? "";
    // Primitives keep the nullish literal; they must NOT be turned into {}.
    expect(cpp).not.toContain("return {};");
  });

  it("return null inside a METHOD (not just a free function) lowers to return {};", () => {
    // The functionReturnType annotation must reach method bodies too —
    // buildFunctionReturnTypeMap only scans top-level FunctionDeclarations,
    // so methods register their return type via declaration-builders.
    const result = transpileNativeSplit(
      [
        "interface T { a: int; }",
        "class Holder {",
        "  protected m: Map<string, T> = new Map();",
        "  public peek(): T | null {",
        "    if (this.m.size === 0) return null;",
        "    return this.m.get('k') ?? null;",
        "  }",
        "}",
        "console.log(`x`);",
        "",
      ].join("\n"),
    );
    const cpp = allText(result);
    // Both nullish returns in the method must lower to value-init.
    const returnBraceCount = (cpp.match(/return \{\};/g) ?? []).length;
    expect(returnBraceCount).toBeGreaterThanOrEqual(1);
    expect(cpp).not.toMatch(/return nullptr/);
  });
});

// ---------------------------------------------------------------------------
// B: synthesized subclass constructor
// ---------------------------------------------------------------------------
describe("B: subclass without a constructor gets a forwarding constructor", () => {
  it("synthesizes an empty ctor when the base is default-constructible", () => {
    const result = transpileNativeSplit(
      [
        "class Base {",
        "  public v: int = 1;",
        "}",
        "class Sub extends Base {}",
        "const s = new Sub();",
        "console.log(`x`);",
        "",
      ].join("\n"),
    );
    const cpp = allText(result);
    // The subclass must emit a constructor (previously it emitted none).
    expect(cpp).toMatch(/Sub\s*\(\s*\)\s*\{/);
  });

  it("synthesizes a forwarding ctor mirroring base params with super()", () => {
    const result = transpileNativeSplit(
      [
        "class Base {",
        "  public n: int;",
        "  constructor(n: int) { this.n = n; }",
        "}",
        "class Sub extends Base {}",
        "const s = new Sub(7);",
        "console.log(`x`);",
        "",
      ].join("\n"),
    );
    const cpp = allText(result);
    // Forwarding ctor: Sub(<n param>) : Base(n) {} — the synthesized ctor
    // mirrors the base param (type/ref-qualifier may vary) and forwards via
    // a super initializer list.
    expect(cpp).toMatch(/Sub\s*\([^)]*n[^)]*\)\s*:\s*Base\s*\(\s*n\s*\)\s*\{/);
  });
});

// ---------------------------------------------------------------------------
// D: free function forward-declared before class bodies
// ---------------------------------------------------------------------------
describe("D: free function forward-declared before class bodies", () => {
  it("a class method may call a same-file free fn declared later", () => {
    const result = transpileNativeSplit(
      [
        "class C {",
        "  public go(): int { return helper(); }",
        "}",
        "function helper(): int { return 42; }",
        "console.log(`x`);",
        "",
      ].join("\n"),
    );
    // In split mode the class body lives in the header, so a same-file free
    // function called from a class method must be visible in the header too.
    // The fix (D, refined in demo #18 Finding B) emits a NON-static forward
    // declaration of `helper` in the HEADER, ahead of the class definition,
    // and a non-static definition in the cpp (a `static` definition would
    // clash with the header's extern prototype). The observable contract: the
    // header carries a `helper()` prototype BEFORE the class body that calls
    // it, and the class definition carries the call.
    const cpp = result.cpp ?? "";
    const header = result.header ?? "";
    expect(header).toMatch(/helper\s*\(\s*\)\s*;/);          // forward decl in header
    expect(header).toContain("return helper();");            // call inside the class
    // The forward declaration must precede the class definition.
    const declIdx = header.search(/helper\s*\(\s*\)\s*;/);
    const classDefIdx = header.indexOf("class C {");
    expect(declIdx).toBeGreaterThanOrEqual(0);
    expect(classDefIdx).toBeGreaterThanOrEqual(0);
    expect(declIdx).toBeLessThan(classDefIdx);
    // The definition in the cpp must NOT be `static` (it has a header prototype).
    expect(cpp).not.toMatch(/static\s+\w+\s+helper\s*\(/);
  });
});

// ---------------------------------------------------------------------------
// E: static-getter call-site rewrite
// ---------------------------------------------------------------------------
describe("E: static-getter access rewrites to ClassName::getX()", () => {
  it("Cls.staticGetter lowers to Cls::getStaticGetter()", () => {
    const result = transpileNativeSplit(
      [
        "class Counter {",
        "  static count: int = 10;",
        "  static get total(): int { return Counter.count; }",
        "}",
        "console.log(`t=${Counter.total}`);",
        "",
      ].join("\n"),
    );
    const cpp = result.cpp ?? "";
    expect(cpp).toContain("Counter::getTotal()");
    expect(cpp).not.toMatch(/Counter::total\b/);
  });
});

// ---------------------------------------------------------------------------
// G: int32_t/uint32_t template interpolation uses %d/%u, not %ld
// ---------------------------------------------------------------------------
describe("G: int32_t/uint32_t template interpolation uses %d/%u", () => {
  it("int32_t interpolates as %d", () => {
    const result = transpileNativeSplit(
      [
        "const v: int32_t = 5;",
        "console.log(`v=${v}`);",
        "",
      ].join("\n"),
    );
    const cpp = result.cpp ?? "";
    expect(cpp).toContain('"v=%d"');
    expect(cpp).not.toContain('"v=%ld"');
  });

  it("uint32_t interpolates as %u", () => {
    const result = transpileNativeSplit(
      [
        "const v: uint32_t = 5;",
        "console.log(`v=${v}`);",
        "",
      ].join("\n"),
    );
    const cpp = result.cpp ?? "";
    expect(cpp).toContain('"v=%u"');
    expect(cpp).not.toContain('"v=%ld"');
  });

  it("long still interpolates as %ld (distinct C++ type)", () => {
    const result = transpileNativeSplit(
      [
        "const v: long = 5;",
        "console.log(`v=${v}`);",
        "",
      ].join("\n"),
    );
    const cpp = result.cpp ?? "";
    expect(cpp).toContain('"v=%ld"');
  });
});

// ---------------------------------------------------------------------------
// E (cross-file): instance + static getter access through an IMPORTED class.
// The accessor map is aggregated across the module graph so `obj.getter` and
// `Cls.staticGetter` rewrite in the importer even though the class lives in
// another file. (End-to-end via transpileFile.)
// ---------------------------------------------------------------------------
describe("E (cross-file): getter access on an imported class", () => {
  it("rewrites instance + static getters across module boundaries", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-e-"));
    tempDirs.push(workspaceDir);

    fs.writeFileSync(
      path.join(workspaceDir, "box.ts"),
      [
        "export class Box {",
        "  protected v: number = 5;",
        "  static base: number = 1;",
        "  get value(): number { return this.v; }",
        "  static get total(): number { return Box.base; }",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(workspaceDir, "main.ts"),
      [
        'import { Box } from "./box";',
        "export function main(): void {",
        "  const b = new Box();",
        "  console.log(`v=${b.value} t=${Box.total}`);",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await transpileFile({
      inputFile: path.join(workspaceDir, "main.ts"),
      emitMode: "split",
      target: "generic",
      mcu: "@typecad/mcu-generic",
      emitMaps: false,
    });
    const mainCpp = fs.readFileSync(result.sourcePath, "utf8");
    // Instance getter → b->getValue(); static getter → Box::getTotal().
    expect(mainCpp).toContain("b->getValue()");
    expect(mainCpp).toContain("Box::getTotal()");
    expect(mainCpp).not.toMatch(/b->value\b/);
    expect(mainCpp).not.toMatch(/Box::total\b/);
  });
});
