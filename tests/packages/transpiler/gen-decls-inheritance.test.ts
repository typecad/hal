import { describe, it, expect } from "vitest";
import { stripPreprocessorBlocks, parseHeader, BaseClassResolver } from "@typecad/cuttlefish/testing";

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
