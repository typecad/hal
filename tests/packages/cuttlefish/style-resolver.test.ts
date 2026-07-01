import { describe, it, expect } from "vitest";
import { resolveStyles } from "@typecad/cuttlefish/ui/style-resolver";
import { parseHtml } from "@typecad/cuttlefish/ui/html-parser";
import { parseCss } from "@typecad/cuttlefish/ui/css-parser";

function resolve(src: string, css: string) {
  return resolveStyles(parseHtml(src), parseCss(css));
}

describe("style resolver", () => {
  it("applies element selector to all matching tags", () => {
    const styled = resolve(`<screen><text id="t">hi</text></screen>`, `screen { padding: 8; }`);
    expect(styled.style.padding).toBe("8");
  });

  it("applies id selector", () => {
    const styled = resolve(`<screen><text id="t">hi</text></screen>`, `#t { color: #ff0000; }`);
    expect(styled.children[0].style.color).toBe("#ff0000");
  });

  it("applies class selector", () => {
    const styled = resolve(`<screen><view class="card"></view></screen>`, `.card { padding: 4; }`);
    expect(styled.children[0].style.padding).toBe("4");
  });

  it("later rules override earlier rules (cascade)", () => {
    const styled = resolve(
      `<screen><text id="t">hi</text></screen>`,
      `#t { color: #ff0000; } #t { color: #00ff00; }`,
    );
    expect(styled.children[0].style.color).toBe("#00ff00");
  });

  it("base state and :pressed state resolve separately", () => {
    const styled = resolve(
      `<screen><button id="btn">x</button></screen>`,
      `#btn { background: #404040; } #btn:pressed { background: #808080; }`,
    );
    const btn = styled.children[0];
    expect(btn.style.background).toBe("#404040");
    expect(btn.style.pressed?.background).toBe("#808080");
  });

  it("maps the hidden attribute to display none after inline styles", () => {
    const styled = resolve(
      `<screen><view id="panel" hidden style="display: flex"></view></screen>`,
      ``,
    );
    expect(styled.children[0].style.display).toBe("none");
  });

  it("attribute selector [disabled] matches disabled elements", () => {
    const styled = resolve(
      `<screen><button id="a" disabled>off</button><button id="b">on</button></screen>`,
      `[disabled] { opacity: 50; }`,
    );
    expect(styled.children[0].style.opacity).toBe("50");
    // The non-disabled sibling must not match.
    expect(styled.children[1].style.opacity).toBeUndefined();
  });

  it("attribute selector [type=\"number\"] matches by exact value", () => {
    const styled = resolve(
      `<screen><input id="a" type="number"/><input id="b" type="text"/></screen>`,
      `[type="number"] { border-color: #ff0000; }`,
    );
    expect(styled.children[0].style.borderColor).toBe("#ff0000");
    expect(styled.children[1].style.borderColor).toBeUndefined();
  });

  it("child combinator only matches direct children", () => {
    // view > text matches text whose IMMEDIATE parent is a view.
    // #direct (parent=view) matches; #nested (parent=text, grandparent=view)
    // must NOT — it's a grandchild via a non-view parent.
    //
    // Uses `background` (not `color`) because color now inherits: a `color` set
    // on #nested would otherwise flow into #deep and make the `undefined`
    // assertion below pass for the wrong reason. `background` does not inherit,
    // so it isolates the selector-boundary behavior under test.
    const styled = resolve(
      `<screen><view><text id="direct">a</text><text id="nested"><text id="deep">b</text></text></view></screen>`,
      `view > text { background: #00ff00; }`,
    );
    const view = styled.children[0];
    const direct = view.children[0];
    const nested = view.children[1];          // parent is view → matches
    const deep = nested.children[0];          // parent is text, not view → must NOT match
    expect(direct.id).toBe("direct");
    expect(direct.style.background).toBe("#00ff00");
    expect(nested.id).toBe("nested");
    expect(nested.style.background).toBe("#00ff00");
    expect(deep.id).toBe("deep");
    // deep's immediate parent is a <text>, not a <view>, so view > text fails,
    // AND background does not inherit, so #deep stays unset.
    expect(deep.style.background).toBeUndefined();
  });

  it("descendant combinator still matches at any depth", () => {
    // Regression guard: the child-combinator fix must not break the plain
    // descendant (space) combinator, which must still match grandchildren.
    const styled = resolve(
      `<screen><view><view><text id="deep">b</text></view></view></screen>`,
      `view text { color: #0000ff; }`,
    );
    const deep = styled.children[0].children[0].children[0];
    expect(deep.id).toBe("deep");
    expect(deep.style.color).toBe("#0000ff");
  });

  it(":not() excludes matching elements", () => {
    const styled = resolve(
      `<screen><button id="a" class="active">x</button><button id="b">y</button></screen>`,
      `button:not(.active) { color: #ff0000; }`,
    );
    // #a has .active → excluded. #b lacks it → matched.
    expect(styled.children[0].style.color).toBeUndefined();
    expect(styled.children[1].style.color).toBe("#ff0000");
  });

  it("adjacent sibling combinator (+) matches only the immediate next sibling", () => {
    // .first + text → the text immediately after .first matches; a later text does not.
    const styled = resolve(
      `<screen><view class="first"></view><text id="adj">a</text><text id="far">b</text></screen>`,
      `.first + text { color: #00ff00; }`,
    );
    expect(styled.children[1].style.color).toBe("#00ff00"); // #adj
    expect(styled.children[2].style.color).toBeUndefined(); // #far
  });

  it("general sibling combinator (~) matches any following sibling", () => {
    // .first ~ text → both following text siblings match.
    const styled = resolve(
      `<screen><view class="first"></view><text id="a">x</text><text id="b">y</text></screen>`,
      `.first ~ text { color: #0000ff; }`,
    );
    expect(styled.children[1].style.color).toBe("#0000ff");
    expect(styled.children[2].style.color).toBe("#0000ff");
  });

  it("tag selectors match remapped HTML tags (label, a) via origTag", () => {
    // <label> and <a> are remapped to <text> internally, but CSS `label { }`
    // and `a { }` selectors must still match them (regression for the
    // invisible-label/link bug where remapped tags broke selector matching).
    const styled = resolve(
      `<screen><view id="row"><label for="x">Label</label></view><a href="#t">Link</a></screen>`,
      `label { color: #ff0000; } a { color: #0000ff; }`,
    );
    // The label (child of #row) should get red from the `label` selector.
    expect(styled.children[0].children[0].style.color).toBe("#ff0000");
    // The link should get blue from the `a` selector.
    expect(styled.children[1].style.color).toBe("#0000ff");
  });

  it("descendant selectors with remapped tags match (e.g. #row label)", () => {
    const styled = resolve(
      `<screen><view id="row"><label for="x">Label</label></view></screen>`,
      `#row label { color: #00ff00; }`,
    );
    expect(styled.children[0].children[0].style.color).toBe("#00ff00");
  });
});

describe("pseudo-class state gating (:checked/:disabled/:focus)", () => {
  // Regression: the resolver only gated :pressed; :checked/:disabled/:focus
  // rules were applied UNCONDITIONALLY (the else branch), so an unchecked
  // radio got the :checked color, an enabled button got :disabled styling, etc.
  it(":checked applies only when the node is checked", () => {
    const styled = resolve(
      `<screen>
         <radio id="on" checked>On</radio>
         <radio id="off">Off</radio>
       </screen>`,
      `radio { color: #ffffff; } radio:checked { color: #0066ff; }`,
    );
    const on = styled.children[0];
    const off = styled.children[1];
    expect(on.style.color).toBe("#0066ff");   // checked → accent
    expect(off.style.color).toBe("#ffffff");  // unchecked → base white
  });

  it(":disabled applies only when the node is disabled", () => {
    const styled = resolve(
      `<screen>
         <button id="d" disabled>D</button>
         <button id="e">E</button>
       </screen>`,
      `button { opacity: 1; } button:disabled { opacity: 0.5; }`,
    );
    expect(styled.children[0].style.opacity).toBe("0.5");  // disabled → faded
    expect(styled.children[1].style.opacity).toBe("1");   // enabled → full
  });
});

describe("CSS inheritance", () => {
  // The standard browser set of inherited properties (color, font-*, text-align,
  // line-height, letter-spacing, white-space, text-transform, text-shadow,
  // text-overflow, visibility) flows from parent to child unless the child sets
  // its own value. Box-model and decorative properties do NOT inherit.

  it("inherits color from the parent", () => {
    const styled = resolve(
      `<screen><view id="row"><text id="child">hi</text></view></screen>`,
      `#row { color: #ff0000; }`,
    );
    expect(styled.children[0].children[0].style.color).toBe("#ff0000");
  });

  it("inherits color through multiple levels (grandchild)", () => {
    const styled = resolve(
      `<screen><view id="a"><view id="b"><text id="deep">hi</text></view></view></screen>`,
      `#a { color: #00ff00; }`,
    );
    const deep = styled.children[0].children[0].children[0];
    expect(deep.style.color).toBe("#00ff00");
  });

  it("inherits font-size and font-weight from a grandparent", () => {
    const styled = resolve(
      `<screen><view id="gp"><view><text id="deep">hi</text></view></view></screen>`,
      `#gp { font-size: 28px; font-weight: bold; }`,
    );
    const deep = styled.children[0].children[0].children[0];
    expect(deep.style.fontSize).toBe("28px");
    expect(deep.style.fontWeight).toBe("bold");
  });

  it("child's own rule overrides the inherited value", () => {
    const styled = resolve(
      `<screen><view id="row"><text id="child">hi</text></view></screen>`,
      `#row { color: #ff0000; } #child { color: #0000ff; }`,
    );
    expect(styled.children[0].children[0].style.color).toBe("#0000ff");
  });

  it("inline style on the child overrides the inherited value", () => {
    const styled = resolve(
      `<screen><view id="row"><text id="child" style="color: #0000ff">hi</text></view></screen>`,
      `#row { color: #ff0000; }`,
    );
    expect(styled.children[0].children[0].style.color).toBe("#0000ff");
  });

  it("does NOT inherit non-inherited properties (background, padding)", () => {
    const styled = resolve(
      `<screen><view id="row"><text id="child">hi</text></view></screen>`,
      `#row { background: #ff0000; padding: 8; }`,
    );
    const child = styled.children[0].children[0];
    expect(child.style.background).toBeUndefined();
    expect(child.style.padding).toBeUndefined();
  });

  it("a child overriding an inherited value does not change the parent's value", () => {
    // The parent keeps its own resolved value even when a child sets its own.
    const styled = resolve(
      `<screen><view id="row"><text id="c1">a</text><text id="c2" style="color: #00ff00">b</text></view></screen>`,
      `#row { color: #ff0000; }`,
    );
    const row = styled.children[0];
    expect(row.style.color).toBe("#ff0000");
    expect(row.children[0].style.color).toBe("#ff0000");   // inherits
    expect(row.children[1].style.color).toBe("#00ff00");   // own inline wins
  });

  it("inherits font-size/font-weight set by the UA stylesheet (h1 > span)", () => {
    // The UA sheet sets font-size and font-weight on h1-h6. A <span> inside an
    // <h1> now inherits those UA-provided values.
    const styled = resolveStyles(parseHtml(`<screen><h1 id="h"><span id="s">Title</span></h1></screen>`), []);
    const span = styled.children[0].children[0];
    expect(span.style.fontSize).toBe(styled.children[0].style.fontSize);
    expect(span.style.fontWeight).toBe(styled.children[0].style.fontWeight);
  });

  it("inherits text-align and line-height", () => {
    const styled = resolve(
      `<screen><view id="row"><text id="child">hi</text></view></screen>`,
      `#row { text-align: center; line-height: 1.4; }`,
    );
    const child = styled.children[0].children[0];
    expect(child.style.textAlign).toBe("center");
    expect(child.style.lineHeight).toBe("1.4");
  });

  it("opacity does not inherit (compounded separately at lower time)", () => {
    // Opacity is excluded from inheritance: the lowering compounds
    // effectiveOpacity down the tree instead. Here, a child with no opacity
    // rule keeps its own style.opacity undefined.
    const styled = resolve(
      `<screen><view id="row" style="opacity: 0.5"><text id="child">hi</text></view></screen>`,
      ``,
    );
    expect(styled.children[0].style.opacity).toBe("0.5");
    expect(styled.children[0].children[0].style.opacity).toBeUndefined();
  });
});
