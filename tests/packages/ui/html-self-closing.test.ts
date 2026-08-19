// Self-closing non-void elements must not nest: HTML-spec parsers treat
// `<view/>` as an open tag, so JSX-habit markup silently put following
// siblings INSIDE the previous element (the spinner card and the skeleton
// demo both mis-nested before the normalizer).
import { describe, it, expect } from "vitest";
import { parseHtml } from "@typecad/ui/ui-engine/html-parser";

function treeOf(html: string): any {
  const root = parseHtml(html);
  const simplify = (n: any): any => ({
    tag: n.tag,
    classes: (n.classes || []).join("."),
    children: (n.children || []).map(simplify),
  });
  return simplify(root);
}

describe("self-closing tag normalization", () => {
  it("expands <view/> to an explicit pair (following siblings stay siblings)", () => {
    const t = treeOf(`<screen id="t"><view class="wrap"><view class="a"/><view class="b"/><text>hi</text></view></screen>`);
    expect(t.children[0].children.map((c: any) => c.classes)).toEqual(["a", "b", ""]);
    expect(t.children[0].children[2].tag).toBe("text");
  });

  it("handles nested self-closing inside an explicitly closed parent", () => {
    const t = treeOf(`<screen id="t"><view class="card"><view class="spinner"><view class="spinner-dot"/></view><text>hi</text></view></screen>`);
    const card = t.children[0];
    expect(card.children.map((c: any) => c.classes)).toEqual(["spinner", ""]);
    expect(card.children[0].children.map((c: any) => c.classes)).toEqual(["spinner-dot"]);
  });

  it("leaves void elements (img/hr/input) untouched", () => {
    const t = treeOf(`<screen id="t"><view><img id="a" src="x.png"/><hr class="separator"/><text>t</text></view></screen>`);
    const view = t.children[0];
    // hr remaps to view (the separator feature); the img stays an img and
    // neither swallows the following text.
    expect(view.children.map((c: any) => c.tag)).toEqual(["img", "view", "text"]);
    expect(view.children[1].classes).toBe("separator");
  });

  it("does not rewrite self-closed tags inside quoted attribute values", () => {
    const t = treeOf(`<screen id="t"><view class="wrap" data-x="a/b"/><text>ok</text></screen>`);
    // The slash inside the quoted attr must not prevent the expansion: wrap
    // ends up EMPTY with the text as its sibling (not its child).
    expect(t.children[0].classes).toBe("wrap");
    expect(t.children[0].children.length).toBe(0);
    expect(t.children[1].tag).toBe("text");
  });
});
