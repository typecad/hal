import { describe, it, expect } from "vitest";
import { parseHtml } from "@typecad/cuttlefish/ui/html-parser";

// Integration tests for inline-sequence collection. These exercise
// collectInlineSequence (Task 1) through the real parseHtml path (Task 2),
// which is more robust than reconstructing a linkedom DOM by hand.

describe("html-parser inline integration", () => {
  it("populates node.inline for mixed content and leaves text empty", () => {
    const tree = parseHtml(`<screen><p id="p">Hello <b>world</b></p></screen>`);
    const p = tree.children[0];
    expect(p.inline).toBeDefined();
    expect(p.inline!.length).toBe(2);
    expect(p.inline![0].kind).toBe("text");
    expect((p.inline![0] as { text: string }).text).toBe("Hello ");
    expect(p.inline![1].kind).toBe("element");
    expect((p.inline![1] as { origTag?: string }).origTag).toBe("b");
    expect(p.text).toBeUndefined();        // inline present → text empty
    expect(p.children).toEqual([]);        // b absorbed, not a child node
  });

  it("emits a hard-break item for <br>", () => {
    const tree = parseHtml(`<screen><p id="p">a<br>b</p></screen>`);
    const p = tree.children[0];
    expect(p.inline!.map(i => i.kind)).toEqual(["text", "break", "text"]);
  });

  it("recurses into nested inline (b > i)", () => {
    const tree = parseHtml(`<screen><p>x <b>bold <i>both</i></b> y</p></screen>`);
    const p = tree.children[0];
    // text "x ", element(b)[ text "bold ", element(i)[ text "both" ] ], text " y"
    expect(p.inline!.length).toBe(3);
    const b = p.inline![1] as { origTag?: string; inline?: { kind: string; origTag?: string }[] };
    expect(b.origTag).toBe("b");
    expect(b.inline!.length).toBe(2);
    expect(b.inline![1].origTag).toBe("i");
  });

  it("does not populate inline for plain text (existing single-string path)", () => {
    const tree = parseHtml(`<screen><text id="t">hi</text></screen>`);
    expect(tree.children[0].inline).toBeUndefined();
    expect(tree.children[0].text).toBe("hi");
  });

  it("does not populate inline when block children are present (view inside p)", () => {
    const tree = parseHtml(`<screen><p id="p">text <view></view></p></screen>`);
    const p = tree.children[0];
    expect(p.inline).toBeUndefined();
    // The view becomes a child node (block breaks inline flow).
    expect(p.children.length).toBe(1);
  });

  it("captures href on an <a> item", () => {
    const tree = parseHtml(`<screen><p id="p">see <a href="#home">link</a></p></screen>`);
    const a = tree.children[0].inline![1] as { origTag?: string; href?: string };
    expect(a.origTag).toBe("a");
    expect(a.href).toBe("#home");
  });

  it("recognizes b/strong/i/em/u (no unknown-tag warning)", () => {
    const diags: { code?: string }[] = [];
    parseHtml(`<screen><p><b>b</b><strong>s</strong><i>i</i><em>e</em><u>u</u></p></screen>`, diags as any);
    expect(diags.filter(d => d.code === "unknown-html-tag")).toEqual([]);
  });

  it("captures class and style on an inline element item", () => {
    const tree = parseHtml(`<screen><p>a <b class="emph" style="color:#f00">b</b></p></screen>`);
    const b = tree.children[0].inline![1] as { classes: string[]; inlineStyle?: string };
    expect(b.classes).toEqual(["emph"]);
    expect(b.inlineStyle).toBe("color:#f00");
  });
});
