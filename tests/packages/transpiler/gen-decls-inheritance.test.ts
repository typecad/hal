import { describe, it, expect } from "vitest";
import { stripPreprocessorBlocks, parseHeader, BaseClassResolver, buildClassIndex, generateDecl, generateDeclsForDirectory } from "@typecad/cuttlefish/testing";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gen-decls-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function cleanDecls(root: string) {
  if (!fs.existsSync(root)) return;
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      cleanDecls(full);
    } else if (e.name.endsWith(".d.ts")) {
      fs.rmSync(full);
    }
  }
}

describe("stripPreprocessorBlocks", () => {
  it("removes a single #if ... #endif block", () => {
    const input = [
      "void before();",
      "#if !defined(ESP8266)",
      "void guarded();",
      "#endif",
      "void after();",
    ].join("\n");
    const out = stripPreprocessorBlocks(input);
    expect(out).toContain("void before();");
    expect(out).toContain("void after();");
    expect(out).not.toContain("void guarded();");
    expect(out).not.toContain("#if");
    expect(out).not.toContain("#endif");
  });

  it("removes nested #if blocks", () => {
    const input = [
      "#if defined(A)",
      "void outer();",
      "#if defined(B)",
      "void inner();",
      "#endif",
      "void outerTail();",
      "#endif",
      "void after();",
    ].join("\n");
    const out = stripPreprocessorBlocks(input);
    expect(out).toContain("void after();");
    expect(out).not.toContain("void outer();");
    expect(out).not.toContain("void inner();");
  });

  it("leaves content with no preprocessor blocks unchanged except whitespace", () => {
    const input = "void foo();\nvoid bar();";
    expect(stripPreprocessorBlocks(input).trim()).toBe(input.trim());
  });
});

describe("parseHeader", () => {
  it("parses a flat class with no base", () => {
    const h = "class Foo {\npublic:\n  Foo();\n  void bar(int x);\n};";
    const classes = parseHeader(h);
    expect(classes).toHaveLength(1);
    expect(classes[0].name).toBe("Foo");
    expect(classes[0].baseClass).toBeUndefined();
    expect(classes[0].source).toBe("header");
    expect(classes[0].constructors).toHaveLength(1);
    expect(classes[0].methods.map(m => m.name)).toEqual(["bar"]);
  });

  it("captures a single-inheritance base class", () => {
    const h = "class Adafruit_ILI9341 : public Adafruit_SPITFT {\npublic:\n  void begin();\n};";
    const classes = parseHeader(h);
    expect(classes[0].name).toBe("Adafruit_ILI9341");
    expect(classes[0].baseClass).toBe("Adafruit_SPITFT");
  });

  it("captures protected/private inheritance as base too", () => {
    const h = "class Foo : protected Bar {\npublic:\n  void baz();\n};";
    expect(parseHeader(h)[0].baseClass).toBe("Bar");
  });

  it("parses multiple classes in one header", () => {
    const h = [
      "class Adafruit_GFX : public Print {",
      "public:",
      "  void fillRect();",
      "};",
      "class GFXcanvas1 : public Adafruit_GFX {",
      "public:",
      "  GFXcanvas1();",
      "};",
    ].join("\n");
    const classes = parseHeader(h);
    expect(classes.map(c => c.name)).toEqual(["Adafruit_GFX", "GFXcanvas1"]);
    expect(classes[1].baseClass).toBe("Adafruit_GFX");
  });

  it("ignores multiple inheritance beyond the first base", () => {
    const h = "class Foo : public A, public B {\npublic:\n  void x();\n};";
    expect(parseHeader(h)[0].baseClass).toBe("A");
  });

  it("ignores forward declarations (class with no body)", () => {
    const h = "class ForwardDecl;\nclass Real { public: void x(); };";
    expect(parseHeader(h).map(c => c.name)).toEqual(["Real"]);
  });

  it("ignores templated class declarations", () => {
    const h = "template <typename T>\nclass Templated { public: void x(); };";
    expect(parseHeader(h)).toHaveLength(0);
  });
});

describe("BaseClassResolver", () => {
  it("resolves a class indexed in a header", () => {
    const index = new Map([["Adafruit_SPITFT", "/lib/Adafruit_GFX_Library/Adafruit_SPITFT.h"]]);
    const resolver = new BaseClassResolver(index);
    expect(resolver.resolve("Adafruit_SPITFT")).toEqual({
      kind: "found",
      headerPath: "/lib/Adafruit_GFX_Library/Adafruit_SPITFT.h",
    });
  });

  it("returns external for an unknown class", () => {
    const index = new Map([["Adafruit_SPITFT", "/x.h"]]);
    const resolver = new BaseClassResolver(index);
    expect(resolver.resolve("Print")).toEqual({ kind: "external" });
  });

  it("returns external when the index is empty", () => {
    const resolver = new BaseClassResolver(new Map());
    expect(resolver.resolve("Anything")).toEqual({ kind: "external" });
  });
});

describe("buildClassIndex", () => {
  it("indexes classes from .h files across subdirectories", () => {
    const root = path.resolve(__dirname, "../../../tests/fixtures/cpp-inheritance");
    const index = buildClassIndex(root);
    expect(index.get("Base")).toBe(path.join(root, "libB", "Base.h"));
    expect(index.get("Dependent")).toBe(path.join(root, "libA", "Dependent.h"));
  });
});

describe("generateDecl", () => {
  it("emits a flat class for a header with no base", () => {
    withTempDir((dir) => {
      const h = path.join(dir, "Foo.h");
      fs.writeFileSync(h, "class Foo {\npublic:\n  void bar();\n};\n", "utf8");
      const out = generateDecl(h);
      expect(out).toBe(path.join(dir, "Foo.d.ts"));
      expect(fs.readFileSync(out!, "utf8")).toContain("export declare class Foo {");
    });
  });

  it("emits extends for a same-file base", () => {
    withTempDir((dir) => {
      const h = path.join(dir, "GFX.h");
      fs.writeFileSync(h, [
        "class GFX { public: void fillRect(); };",
        "class Canvas1 : public GFX { public: Canvas1(); };",
      ].join("\n"));
      const out = generateDecl(h);
      const content = fs.readFileSync(out!, "utf8");
      expect(content).toContain("export declare class Canvas1 extends GFX {");
      expect(content).not.toContain("import type");
    });
  });

  it("merges .cpp impl-only methods into the .h class", () => {
    withTempDir((dir) => {
      const h = path.join(dir, "Foo.h");
      const cpp = path.join(dir, "Foo.cpp");
      fs.writeFileSync(h, "class Foo {\npublic:\n  Foo();\n};\n", "utf8");
      fs.writeFileSync(cpp, "void Foo::extraMethod(int x) { }\n", "utf8");
      const out = generateDecl(h);
      const content = fs.readFileSync(out!, "utf8");
      expect(content).toContain("extraMethod(x: number): void;");
    });
  });

  it("writes .d.ts next to the input with matching basename", () => {
    withTempDir((dir) => {
      const h = path.join(dir, "Foo.h");
      fs.writeFileSync(h, "class Foo { public: void bar(); };", "utf8");
      const out = generateDecl(h);
      expect(path.basename(out!)).toBe("Foo.d.ts");
      expect(path.dirname(out!)).toBe(dir);
    });
  });

  it("returns null when the file has no classes or constants", () => {
    withTempDir((dir) => {
      const h = path.join(dir, "Empty.h");
      fs.writeFileSync(h, "// just a comment\n", "utf8");
      expect(generateDecl(h)).toBeNull();
    });
  });
});

describe("generateDeclsForDirectory — cross-lib inheritance", () => {
  it("emits import type for a base in another scanned header", () => {
    const root = path.resolve(__dirname, "../../../tests/fixtures/cpp-inheritance");
    cleanDecls(root);
    const created = generateDeclsForDirectory(root, true);
    const dependentDts = path.join(root, "libA", "Dependent.d.ts");
    expect(created).toContain(dependentDts);
    const content = fs.readFileSync(dependentDts, "utf8");
    expect(content).toContain('import type { Base } from "../libB/Base";');
    expect(content).toContain("export declare class Dependent extends Base {");
  });

  it("emits an empty stub for an unresolved base", () => {
    withTempDir((dir) => {
      const h = path.join(dir, "Foo.h");
      fs.writeFileSync(h, "class Foo : public Bar {\npublic:\n  void x();\n};\n", "utf8");
      // Single-file mode has no resolver → Bar is unresolved → stub.
      generateDecl(h);
      const dts = fs.readFileSync(path.join(dir, "Foo.d.ts"), "utf8");
      expect(dts).toContain("declare class Bar {}");
      expect(dts).toContain("export declare class Foo extends Bar {");
    });
  });
});
