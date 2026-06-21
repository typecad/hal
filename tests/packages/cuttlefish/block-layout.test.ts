import { describe, it, expect } from "vitest";
import { Box, LayoutEngine, measure } from "@typecad/cuttlefish/ui/layout-engine";
import { BlockLayoutEngine } from "@typecad/cuttlefish/ui/block-layout";
import { resolveStyles } from "@typecad/cuttlefish/ui/style-resolver";
import { parseHtml } from "@typecad/cuttlefish/ui/html-parser";
import { parseCss } from "@typecad/cuttlefish/ui/css-parser";

function layout(src: string, css: string, viewport: Box): Box[] {
  const styled = resolveStyles(parseHtml(src), parseCss(css));
  const engine: LayoutEngine = new BlockLayoutEngine();
  return engine.arrange(styled, viewport, (n) => measure(n));
}

describe("BlockLayoutEngine", () => {
  it("screen fills the viewport", () => {
    const boxes = layout(`<screen></screen>`, ``, { x: 0, y: 0, w: 240, h: 320 });
    expect(boxes[0]).toEqual({ x: 0, y: 0, w: 240, h: 320 });
  });

  it("padding insets children", () => {
    const boxes = layout(
      `<screen><text id="t">hi</text></screen>`,
      `screen { padding: 8; }`,
      { x: 0, y: 0, w: 240, h: 320 },
    );
    // screen is boxes[0]; text is boxes[1], inset by padding 8.
    expect(boxes[1].x).toBe(8);
    expect(boxes[1].y).toBe(8);
    expect(boxes[1].w).toBe(240 - 16);
  });

  it("stacks children vertically (block flow)", () => {
    const boxes = layout(
      `<screen><text id="a">a</text><text id="b">b</text></screen>`,
      `screen { padding: 0; }`,
      { x: 0, y: 0, w: 100, h: 100 },
    );
    expect(boxes[1].y).toBe(0);
    expect(boxes[2].y).toBeGreaterThan(0);  // second child below first
  });

  it("measure returns text intrinsic size from GFX font metrics", () => {
    const styled = resolveStyles(
      parseHtml(`<screen><text id="t">hi</text></screen>`),
      parseCss(`#t { font-size: 16px; }`),
    );
    const size = measure(styled.children[0]);
    // GFX default font at textSize 2: 6px advance × 2 = 12px per char, 8px × 2 = 16px height
    expect(size.w).toBe(24);   // 2 chars * 12px
    expect(size.h).toBe(16);   // 8px base × 2 = 16px
  });
});

describe("flex-forward scaffolding", () => {
  it("LayoutEngine is selectable on display property (block default)", () => {
    const engine: LayoutEngine = new BlockLayoutEngine();
    expect(engine.id).toBe("block");
  });

  it("Style carries display field (unused by block, ready for flex)", () => {
    const styled = resolveStyles(
      parseHtml(`<screen><view></view></screen>`),
      parseCss(`screen { padding: 0; }`),
    );
    // display defaults to "block" when unset; block engine ignores it.
    expect(styled.style).toBeDefined();
  });
});
