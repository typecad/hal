import { describe, expect, it } from "vitest";
import { DEFAULT_SCROLL_CANVAS_BUDGET_BYTES } from "../../../packages/cuttlefish/src/api/shared/display-profile.js";
import { analyzeScrollMemory } from "../../../packages/cuttlefish/src/ui/scroll-memory-diagnostics.js";
import type { UINodeModel } from "../../../packages/cuttlefish/src/ui/model.js";

function scrollNode(overrides: Partial<UINodeModel>): UINodeModel {
  return {
    index: 0,
    tag: "div",
    classes: [],
    box: { x: 0, y: 0, w: 290, h: 200 },
    bg: 0,
    fg: 0xffff,
    kind: "fill",
    textBuffer: "",
    hasTextBinding: false,
    hasBg: true,
    textAlign: 0,
    textSize: 1,
    lineHeight: 0,
    letterSpacing: 0,
    fontAntialias: false,
    fontFace: 0,
    borderColor: 0,
    borderStyle: 0,
    borderWidth: 0,
    borderRadius: 0,
    gradientEnabled: 0,
    gradientColor1: 0,
    gradientColor2: 0,
    outlineColor: 0,
    outlineStyle: 0,
    outlineWidth: 0,
    zIndex: 0,
    transformOffsetX: 0,
    transformOffsetY: 0,
    rotateDeg: 0,
    pressedOffsetX: 0,
    pressedOffsetY: 0,
    shadowCount: 0,
    shadowOffsetX: [0, 0, 0, 0],
    shadowOffsetY: [0, 0, 0, 0],
    shadowBlur: [0, 0, 0, 0],
    shadowColor: [0, 0, 0, 0],
    shadowAlpha: [0, 0, 0, 0],
    shadowInset: [0, 0, 0, 0],
    textShadowCount: 0,
    textShadowOffsetX: 0,
    textShadowOffsetY: 0,
    textShadowBlur: 0,
    textShadowColor: 0,
    textShadowAlpha: 0,
    nowrap: false,
    whiteSpaceMode: 0,
    visible: true,
    opacity: 255,
    clearColor: 0,
    lastTextWidth: 0,
    lastTextHeight: 0,
    dirty: false,
    scrollable: true,
    scrollY: 0,
    contentHeight: 400,
    overscrollPx: 0,
    settling: false,
    lastPaintedScrollY: 0,
    rangeMin: 0,
    rangeMax: 0,
    maxlen: 0,
    parentIndex: -1,
    subtreeEnd: 1,
    screenId: 0,
    imgDataId: 255,
    objectFit: 1,
    listItemHeight: 0,
    virtualized: false,
    canvasW: 0,
    canvasH: 0,
    ...overrides,
  };
}

describe("analyzeScrollMemory", () => {
  it("warns when an overflow scroll viewport exceeds the canvas budget", () => {
    const diags = analyzeScrollMemory([
      scrollNode({ index: 3, id: "detailScroll", box: { x: 0, y: 0, w: 290, h: 200 } }),
    ], DEFAULT_SCROLL_CANVAS_BUDGET_BYTES);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe("scroll-canvas-memory");
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].message).toContain("#detailScroll");
    expect(diags[0].message).toContain("290×200px");
    expect(diags[0].message).toContain("116000");
    expect(diags[0].hint).toContain("Reduce the scroll viewport in CSS");
  });

  it("ignores non-overflow and in-budget scroll containers", () => {
    expect(analyzeScrollMemory([
      scrollNode({ contentHeight: 150, box: { x: 0, y: 0, w: 290, h: 151 } }),
    ])).toHaveLength(0);
    expect(analyzeScrollMemory([
      scrollNode({ scrollable: false, contentHeight: 400 }),
    ])).toHaveLength(0);
  });
});
