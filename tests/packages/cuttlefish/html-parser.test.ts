import { describe, it, expect } from "vitest";
import { parseHtml, parseHtmlWithKeyboards, extractStyleBlocks } from "@typecad/cuttlefish/ui/html-parser";

describe("HTML subset parser", () => {
  it("parses a screen root with children", () => {
    const tree = parseHtml(`<screen><text id="greeting">hello</text></screen>`);
    expect(tree.tag).toBe("screen");
    expect(tree.id).toBeUndefined();
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].tag).toBe("text");
    expect(tree.children[0].id).toBe("greeting");
  });

  it("captures text content of leaf elements", () => {
    const tree = parseHtml(`<screen><text id="t">hello world</text></screen>`);
    expect(tree.children[0].text).toBe("hello world");
  });

  it("captures class attribute", () => {
    const tree = parseHtml(`<screen><view class="card"></view></screen>`);
    expect(tree.children[0].classes).toEqual(["card"]);
  });

  it("rejects a tree with no screen root", () => {
    expect(() => parseHtml(`<text>hi</text>`)).toThrow(/screen/);
  });

  it("returns the first screen when multiple screens are present", () => {
    const tree = parseHtml(`<screen id="home"></screen><screen id="settings"></screen>`);
    expect(tree.id).toBe("home");
  });

  it("parses the canonical hello-world tree", () => {
    const tree = parseHtml([
      `<screen>`,
      `  <text id="greeting">hello world</text>`,
      `  <button id="btn">Click me</button>`,
      `</screen>`,
    ].join("\n"));
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0].id).toBe("greeting");
    expect(tree.children[1].id).toBe("btn");
  });

  it("parses <input> with type, placeholder, maxlength", () => {
    const tree = parseHtml(`<screen><input id="ssid" type="text" placeholder="SSID" maxlength="32"></input></screen>`);
    const input = tree.children[0];
    expect(input.tag).toBe("input");
    expect(input.id).toBe("ssid");
    expect(input.type).toBe("text");
    expect(input.placeholder).toBe("SSID");
    expect(input.maxlength).toBe(32);
  });

  it("defaults <input> type to text and maxlength to 16", () => {
    const tree = parseHtml(`<screen><input id="x"></input></screen>`);
    const input = tree.children[0];
    expect(input.type).toBe("text");
    expect(input.maxlength).toBe(16);
  });

  it("parses type=number", () => {
    const tree = parseHtml(`<screen><input id="port" type="number" maxlength="5"></input></screen>`);
    expect(tree.children[0].type).toBe("number");
    expect(tree.children[0].maxlength).toBe(5);
  });

  it("extracts <style> block contents", () => {
    const css = extractStyleBlocks(`<screen></screen><style>screen { bg: red; }</style>`);
    expect(css).toContain("screen { bg: red; }");
  });

  it("parses inline style attribute", () => {
    const tree = parseHtml(`<screen><text id="t" style="color: red; font-size: 24px">hi</text></screen>`);
    expect(tree.children[0].inlineStyle).toBe("color: red; font-size: 24px");
  });

  it("parses hidden attribute", () => {
    const tree = parseHtml(`<screen><view id="panel" hidden></view></screen>`);
    expect(tree.children[0].hidden).toBe(true);
  });

  it("parses a <keyboard> template alongside <screen>", () => {
    const result = parseHtmlWithKeyboards(`<screen><input id="ssid"></input></screen>
<keyboard id="myKb" variant="alpha">
  <row><key>1</key><key>2</key></row>
  <row><key>q</key><key>w</key></row>
</keyboard>`);
    expect(result.tree.tag).toBe("screen");
    expect(result.keyboards).toHaveLength(1);
    expect(result.keyboards[0].id).toBe("myKb");
    expect(result.keyboards[0].variant).toBe("alpha");
    expect(result.keyboards[0].rows).toHaveLength(2);
    expect(result.keyboards[0].rows[0]).toEqual([
      { ch: "1", special: 0 },
      { ch: "2", special: 0 },
    ]);
  });

  it("returns empty keyboards array when no <keyboard> present", () => {
    const result = parseHtmlWithKeyboards(`<screen><text id="t">hi</text></screen>`);
    expect(result.keyboards).toEqual([]);
  });

  it("recognizes special keys by label in <keyboard>", () => {
    const result = parseHtmlWithKeyboards(`<screen></screen>
<keyboard id="kb" variant="alpha">
  <row><key>⇧</key><key>⌫</key><key>OK</key><key>123</key><key>a</key></row>
</keyboard>`);
    const row = result.keyboards[0].rows[0];
    expect(row[0].special).toBe(1);  // shift
    expect(row[1].special).toBe(2);  // backspace
    expect(row[2].special).toBe(3);  // ok
    expect(row[3].special).toBe(4);  // page-swap
    expect(row[4].special).toBe(0);  // char
  });

  it("remaps HTML block-container aliases to view", () => {
    const tree = parseHtml(`<screen><div id="d"></div><header id="h"></header><nav id="n"></nav></screen>`);
    expect(tree.children[0].tag).toBe("view");
    expect(tree.children[0].id).toBe("d");
    expect(tree.children[1].tag).toBe("view");
    expect(tree.children[2].tag).toBe("view");
  });

  it("remaps <body> to view", () => {
    const tree = parseHtml(`<screen><body id="bd"></body></screen>`);
    expect(tree.children[0].tag).toBe("view");
    expect(tree.children[0].id).toBe("bd");
  });

  it("remaps HTML inline/heading aliases to text", () => {
    const tree = parseHtml(`<screen><span id="s">x</span><p id="par">y</p><h1 id="title">z</h1></screen>`);
    expect(tree.children[0].tag).toBe("text");
    expect(tree.children[0].id).toBe("s");
    expect(tree.children[1].tag).toBe("text");
    expect(tree.children[2].tag).toBe("text");
    expect(tree.children[2].id).toBe("title");
  });

  it("still rejects genuinely unsupported tags at the screen level", () => {
    // A top-level non-screen, non-alias element with no screen root throws.
    expect(() => parseHtml(`<bogus></bogus>`)).toThrow(/screen/);
  });

  it("emits a warning for an unknown child tag when given a diagnostics sink", () => {
    const diags: any[] = [];
    parseHtml(`<screen><marquee id="m">x</marquee></screen>`, diags);
    const unknown = diags.filter(d => d.message.includes("marquee"));
    expect(unknown).toHaveLength(1);
    expect(unknown[0].severity).toBe("warning");
  });

  it("does not warn for remapped HTML alias tags", () => {
    const diags: any[] = [];
    parseHtml(`<screen><div id="d"></div><span id="s">x</span><h1>y</h1></screen>`, diags);
    expect(diags).toHaveLength(0);
  });

  it("emits no warnings when no diagnostics sink is passed (backward compatible)", () => {
    // No diagnostics param — must not throw and must parse normally.
    const tree = parseHtml(`<screen><div id="d"></div></screen>`);
    expect(tree.children[0].tag).toBe("view");
  });
});
