import { describe, it, expect } from "vitest";
import { lowerUIToCpp } from "@typecad/cuttlefish/ir/transformers/ui-lowering";
import { resolveStyles } from "@typecad/cuttlefish/ui/style-resolver";
import { parseHtml } from "@typecad/cuttlefish/ui/html-parser";
import { parseCss } from "@typecad/cuttlefish/ui/css-parser";
import { BlockLayoutEngine } from "@typecad/cuttlefish/ui/block-layout";
import { measure } from "@typecad/cuttlefish/ui/layout-engine";

function lower(html: string, css: string) {
  const styled = resolveStyles(parseHtml(html), parseCss(css));
  const engine = new BlockLayoutEngine();
  const boxes = engine.arrange(styled, { x: 0, y: 0, w: 240, h: 320 }, measure);
  return lowerUIToCpp(styled, boxes, "rgb565", "flash");
}

describe("ui lowering", () => {
  it("emits a UINode static array", () => {
    const out = lower(`<screen></screen>`, ``);
    expect(out.nodeTable).toMatch(/UINode\s+__ui_nodes/);
    expect(out.nodeTable).toContain("NODE_FILL");
  });

  it("resolves hex colors to rgb565 in the node table", () => {
    const out = lower(`<screen></screen>`, `screen { background: #008000; }`);
    // #008000 = half green (g=128): (128 & 0xfc) << 3 = 0x0400.
    // (0x07e0 would be pure green #00ff00; see color.test.ts for that case.)
    expect(out.nodeTable).toContain("0x0400");
  });

  it("emits a transition table for transition-able properties", () => {
    const out = lower(
      `<screen><button id="btn">x</button></screen>`,
      `#btn { background: #404040; transition: background 80ms; }`,
    );
    expect(out.transitionTable).toContain("UITransition");
    expect(out.transitionTable).toContain("80");
  });

  it("emits a .ui.html.d.ts with typed id properties", () => {
    const out = lower(
      `<screen><text id="greeting">hi</text><button id="btn">x</button></screen>`,
      `#greeting { font: 8x16; }`,
    );
    expect(out.typeDecl).toContain("greeting");
    expect(out.typeDecl).toContain("btn");
    expect(out.typeDecl).toMatch(/interface|type/);
  });

  it("emits NODE_TEXT for text/button leaves with text payload", () => {
    const out = lower(
      `<screen><text id="greeting">hello world</text></screen>`,
      `#greeting { color: #ff0000; font: 8x16; }`,
    );
    expect(out.nodeTable).toContain("NODE_TEXT");
    expect(out.nodeTable).toContain("hello world");
  });
});
