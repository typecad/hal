import { describe, it, expect } from "vitest";
import { parseHtml } from "@typecad/cuttlefish/ui/html-parser";

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
});
