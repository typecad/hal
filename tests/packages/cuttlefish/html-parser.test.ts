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

  it("rejects multiple top-level elements", () => {
    expect(() => parseHtml(`<screen></screen><screen></screen>`)).toThrow();
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
});
