// ---------------------------------------------------------------------------
// Regression: parseBoxShadow color-zone detection must include hsl()/hsla().
//
// The color-zone regex searches for #hex, rgb()/rgba(), hsl()/hsla(), and
// named colors. When the hsl family was missing (an accidental revert of the
// original fix), an hsl() box-shadow color made the whole shadow value the
// numeric zone — the h/s/l numbers were then misread as shadow geometry.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { parseCss } from "@typecad/ui/ui-engine/css-parser";
import { parseHtml } from "@typecad/ui/ui-engine/html-parser";
import { measure } from "@typecad/ui/ui-engine/layout-engine";
import { lowerUIToModel } from "@typecad/ui/ui-engine/model";
import { resolveStyles } from "@typecad/ui/ui-engine/style-resolver";
import { resolveColor } from "@typecad/ui/ui-engine/color";
import { selectEngine } from "../../../packages/ui/src/ui-engine/select-engine";

function shadowOf(css: string) {
  const html = `<screen><view id="card">x</view></screen>`;
  const styled = resolveStyles(parseHtml(html), parseCss(css));
  const boxes = selectEngine(styled).arrange(styled, { x: 0, y: 0, w: 320, h: 240 }, measure);
  const model = lowerUIToModel(styled, boxes, "rgb565", {
    driver: "ili9341",
    width: 320,
    height: 240,
    colorFormat: "rgb565",
    rotation: 1,
  });
  const card = model.nodes.find((n) => n.id === "card");
  expect(card).toBeDefined();
  return card!;
}

describe("box-shadow hsl()/hsla() color detection", () => {
  it("reads offsets from the numeric zone and the color from an hsl() value", () => {
    const card = shadowOf(`#card { box-shadow: 4px 6px 8px hsl(210 79% 46%); }`);
    expect(card.shadowCount).toBe(1);
    expect(card.shadowOffsetX[0]).toBe(4);
    expect(card.shadowOffsetY[0]).toBe(6);
    expect(card.shadowBlur[0]).toBe(8);
    expect(card.shadowColor[0]).toBe(resolveColor("hsl(210 79% 46%)", "rgb565"));
  });

  it("handles hsla() with CSS4 slash alpha", () => {
    const card = shadowOf(`#card { box-shadow: inset 0 1px 0 hsla(0, 0%, 100%, 0.5); }`);
    expect(card.shadowCount).toBe(1);
    expect(card.shadowInset[0]).toBe(true);
    expect(card.shadowOffsetX[0]).toBe(0);
    expect(card.shadowOffsetY[0]).toBe(1);
    expect(card.shadowColor[0]).toBe(resolveColor("hsla(0, 0%, 100%, 0.5)", "rgb565"));
  });
});
