import { describe, it, expect } from "vitest";
import { Box, LayoutEngine, measure } from "@typecad/cuttlefish/ui/layout-engine";
import { BlockLayoutEngine } from "@typecad/cuttlefish/ui/block-layout";
import { selectEngine } from "../../../packages/cuttlefish/src/ui/select-engine";
import { resolveStyles } from "@typecad/cuttlefish/ui/style-resolver";
import { parseHtml } from "@typecad/cuttlefish/ui/html-parser";
import { parseCss } from "@typecad/cuttlefish/ui/css-parser";

function layout(src: string, css: string, viewport: Box): Box[] {
  const styled = resolveStyles(parseHtml(src), parseCss(css));
  const engine: LayoutEngine = new BlockLayoutEngine();
  return engine.arrange(styled, viewport, (n, availableWidth) => measure(n, availableWidth));
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

  it("removes display none subtrees from block flow while preserving box order", () => {
    const boxes = layout(
      `<screen><text id="a">a</text><view id="gone"><text id="inside">hidden</text></view><text id="b">b</text></screen>`,
      `screen { padding: 0; } #gone { display: none; }`,
      { x: 0, y: 0, w: 100, h: 100 },
    );

    expect(boxes).toHaveLength(5);
    expect(boxes[1]).toMatchObject({ y: 0, h: 16 });
    expect(boxes[2]).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(boxes[3]).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(boxes[4]).toMatchObject({ y: 16, h: 16 });
  });

  it("applies aspect ratio to block-flow children", () => {
    const boxes = layout(
      `<screen><view id="wide"></view><view id="tall"></view></screen>`,
      `
        screen { padding: 0; }
        #wide { width: 80px; aspect-ratio: 16 / 9; }
        #tall { height: 30px; aspect-ratio: 2 / 1; }
      `,
      { x: 0, y: 0, w: 120, h: 120 },
    );

    expect(boxes[1]).toMatchObject({ w: 80, h: 45 });
    expect(boxes[2]).toMatchObject({ y: 45, w: 60, h: 30 });
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

describe("custom-font (asset) text measurement", () => {
  // Regression: measure() sized every text node's box at 6*ts per char (the
  // default-font advance), even when the node used a custom @font-face whose
  // real glyph advances differ. The drawn text then overflowed its too-narrow
  // box and got clipped (e.g. italic "H6 heading" lost its trailing 'g').
  it("measures a custom-font text node to the real glyph-advance sum, not 6*ts", () => {
    // Fake asset: family "Wide", px 12, every glyph advances 10px (vs 6*ts=6
    // for the default font at ts=1). "ABC" must measure 30, not 18.
    const fakeAsset = {
      id: 1, family: "Wide", sourcePath: "Wide.ttf", px: 12,
      fontWeight: "400", fontStyle: "normal", subset: "exact" as const,
      lineHeight: 12, baseline: 10,
      glyphs: [..."ABC"].map((ch) => ({ codepoint: ch.codePointAt(0)!, xOffset: 0, yOffset: 0, width: 8, height: 10, advance: 10, dataOffset: 0 })),
      alpha: [],
    };
    const styled = resolveStyles(
      parseHtml(`<screen><text id="t" style="font-family: 'Wide'; font-size: 12px">ABC</text></screen>`),
      parseCss(``),
    );
    const text = styled.children[0];
    // measure() with the asset must use the real 10px/glyph advance (30 total),
    // not the 6*ts default-font advance (18 total).
    expect(measure(text, undefined, [fakeAsset]).w).toBe(30);
    // Without the asset it falls back to the 6*ts default (18) — proving the
    // asset path is what changed the result.
    expect(measure(text, undefined, []).w).toBe(18);
  });
});

describe("flex order reorders children", () => {
  // Regression: the yoga binding has no setOrder API, so yoga-layout's
  // `yn.setOrder?.()` was a silent no-op and `order` never repositioned items.
  it("lays out children in order sequence, not source order", () => {
    // Source order: a(order 3), b(order 1), c(order 2). By order the visual
    // sequence must be b(1), c(2), a(3) — leftmost to rightmost. The box array
    // follows the same order-sorted DFS as flatten (and the node table), so
    // boxes[1..3] are in order sequence b, c, a with ascending x.
    const css = `
      #row { display: flex; flex-direction: row; width: 300px; height: 24px; }
      .c { width: 40px; height: 24px; }
      #a { order: 3; }
      #b { order: 1; }
      #c { order: 2; }
    `;
    const html = `<screen id="row"><div id="a" class="c">a</div><div id="b" class="c">b</div><div id="c" class="c">c</div></screen>`;
    const styled = resolveStyles(parseHtml(html), parseCss(css));
    const boxes = selectEngine(styled).arrange(styled, { x: 0, y: 0, w: 320, h: 240 }, measure);
    // box[0] is the screen; boxes[1..3] are the children in order sequence.
    // Visual order by x must be ascending (each chip 40px wide, packed left):
    // position 0, 40, 80 — proving order (not source) drove the layout.
    const xs = boxes.slice(1, 4).map(b => b.x);
    expect(xs).toEqual([0, 40, 80]);
  });
});
