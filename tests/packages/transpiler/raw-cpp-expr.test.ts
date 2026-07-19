// Regression coverage for rawCppExpr — the expression-position raw C++ escape
// hatch added alongside ESP-IDF component support. Mirrors the statement-
// position rawCpp()/__EMIT__ path but lowers in expression context so IDF
// macros like WIFI_INIT_CONFIG_DEFAULT() (which expand to struct initializers)
// can produce values that subsequent TS code consumes.
//
// The TS-side type parameter is a hint only — the transpiler emits the raw
// text verbatim and does not type-check the macro's expansion against T.

import { describe, it, expect } from "vitest";
import { transpileNative } from "../../setup";

describe("rawCppExpr — expression-position raw C++ injection", () => {
  it("lowers a string literal arg verbatim into expression position", () => {
    const cpp = transpileNative(
      [
        "import { rawCppExpr } from '@typecad/hal';",
        "const x = rawCppExpr<number>('WIFI_INIT_CONFIG_DEFAULT()');",
        "console.log(x);",
      ].join("\n"),
    ).cpp;

    // The raw text appears verbatim — no quoting, no snprintf wrapping,
    // no transformation. Just the literal characters of the string arg.
    expect(cpp).toMatch(/WIFI_INIT_CONFIG_DEFAULT\(\)/);
    // The variable is assigned the raw text directly.
    expect(cpp).toMatch(/=\s*WIFI_INIT_CONFIG_DEFAULT\(\)/);
  });

  it("lowers a template-literal arg (no substitutions) verbatim", () => {
    const cpp = transpileNative(
      [
        "import { rawCppExpr } from '@typecad/hal';",
        "const cfg = rawCppExpr<number>(`SOME_MACRO(42)`);",
      ].join("\n"),
    ).cpp;

    expect(cpp).toMatch(/SOME_MACRO\(42\)/);
  });

  it("preserves the raw text inside a larger expression", () => {
    const cpp = transpileNative(
      [
        "import { rawCppExpr } from '@typecad/hal';",
        "const addr = rawCppExpr<number>('&__cfg');",
        "console.log(addr);",
      ].join("\n"),
    ).cpp;
    expect(cpp).toMatch(/&__cfg/);
  });

  it("does not affect statement-position rawCpp", () => {
    // Statement-position rawCpp continues to work as before.
    const cpp = transpileNative(
      [
        "import { rawCpp } from '@typecad/hal';",
        "rawCpp('int __local = 42;');",
        "console.log(__local);",
      ].join("\n"),
    ).cpp;
    expect(cpp).toMatch(/int __local = 42/);
  });
});
