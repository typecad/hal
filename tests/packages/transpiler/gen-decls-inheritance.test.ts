import { describe, it, expect } from "vitest";
import { stripPreprocessorBlocks } from "@typecad/cuttlefish/testing";

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
