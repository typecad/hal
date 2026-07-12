import { describe, it, expect } from "vitest";
import { PreviewUIRuntime } from "../../../packages/ui/src/preview/host-ui-runtime";

// Behavioral tests for the unified scroll engine (preview = capacitive + full
// tier). Mirrors the C++ engine: 1:1 in-bounds, rubber-band at edges, snap/bounce
// on release, no fling. Spec: 2026-06-28-scroll-engine-rewrite-design.md.

// Minimal node factory — only the fields the runtime reads for scroll. Matches
// the shape the preview's cloneProgram expects (it spreads ...node).
function makeNode(o: Record<string, unknown>): any {
  return {
    index: 0,
    tag: "view",
    classes: [],
    box: { x: 0, y: 0, w: 100, h: 100 },
    bg: 0,
    fg: 0xffff,
    kind: "fill",
    textBuffer: "",
    hasTextBinding: false,
    hasBg: true,
    textAlign: 0,
    textSize: 2,
    lineHeight: 16,
    fontAntialias: false,
    fontFace: 0,
    letterSpacing: 0,
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
    shadowOffsetX: [],
    shadowOffsetY: [],
    shadowBlur: [],
    shadowColor: [],
    shadowAlpha: [],
    shadowInset: [],
    textShadowCount: 0,
    textShadowOffsetX: 0,
    textShadowOffsetY: 0,
    textShadowBlur: 0,
    textShadowColor: 0,
    textShadowAlpha: 0,
    underline: false,
    nowrap: false,
    whiteSpaceMode: 0,
    visible: true,
    opacity: 100,
    clearColor: 0,
    lastTextWidth: 0,
    lastTextHeight: 0,
    dirty: false,
    value: 0,
    scrollable: false,
    scrollY: 0,
    contentHeight: 0,
    overscrollPx: 0,
    settling: false,
    lastPaintedScrollY: 0,
    imgDataId: 255,
    objectFit: 1,
    rangeMin: 0,
    rangeMax: 100,
    maxlen: 0,
    parentIndex: -1,
    subtreeEnd: 1,
    ...o,
  };
}

// A generic scroll container (200px of content in a 100px viewport) so the
// in-bounds range is [0, 100] and rubber-band excursions are exercisable.
function makeScrollRuntime(): { runtime: PreviewUIRuntime; scrollNode: () => any } {
  const runtime: any = new PreviewUIRuntime({
    projectRoot: "",
    entryFile: "",
    htmlFile: "",
    uiTreeNames: ["screen"],
    program: {
      width: 100,
      height: 120,
      colorFormat: "rgb565",
      nodes: [
        makeNode({ index: 0, tag: "screen", hasBg: true, subtreeEnd: 2, box: { x: 0, y: 0, w: 100, h: 120 } }),
        makeNode({
          index: 1,
          tag: "view",
          kind: "fill",
          box: { x: 0, y: 10, w: 100, h: 100 },
          hasBg: true,
          bg: 0x0000,
          parentIndex: 0,
          scrollable: true,
          contentHeight: 200, // viewport 100 → maxScroll = 100
          subtreeEnd: 2,
        }),
      ],
      transitions: [],
    },
    font: new Uint8Array(0),
    bindings: [],
    listBindings: [],
    callbacks: [],
    initialAssignments: [],
    intervals: [],
    pinControls: [],
    diagnostics: [],
  } as any);
  runtime.start();
  return { runtime, scrollNode: () => (runtime as any).nodes[1] };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("scroll physics (preview)", () => {
  it("tracks the finger 1:1 in bounds (drag up scrolls content up)", () => {
    const { runtime, scrollNode } = makeScrollRuntime();
    try {
      runtime.pointerDown(10, 50);
      runtime.pointerMove(10, 40); // dy = -10 → scrollY += 10
      runtime.pointerMove(10, 30); // dy = -10 → scrollY += 10
      expect(scrollNode().scrollY).toBe(20); // 1:1 with total upward drag
    } finally {
      runtime.stop();
    }
  });

  it("rubber-bands past the top boundary without moving scrollY below 0", () => {
    const { runtime, scrollNode } = makeScrollRuntime();
    try {
      runtime.pointerDown(10, 50);
      runtime.pointerMove(10, 60); // drag down past top → overscroll
      runtime.pointerMove(10, 100); // keep dragging down (50px past start)
      const node = scrollNode();
      expect(node.scrollY).toBe(0); // committed position never leaves [0, max]
      expect(node.overscrollPx).toBeGreaterThan(0); // ...but the excursion grows
      expect(node.overscrollPx).toBeLessThanOrEqual(40); // clamped at maxOverscroll
    } finally {
      runtime.stop();
    }
  });

  it("snaps to 0 on release when within edgeSnapPx (no exact positioning needed)", async () => {
    const { runtime, scrollNode } = makeScrollRuntime();
    try {
      // Scroll up past the drag threshold (10px) but land within edgeSnapPx=12:
      // drag up 11px → scrollY=11. Release → snaps to 0 for free.
      runtime.pointerDown(10, 50);
      runtime.pointerMove(10, 39); // dy = -11 → scrollY = 11 (past threshold, in snap band)
      expect(scrollNode().scrollY).toBe(11);
      runtime.pointerUp();
      await wait(200);
      runtime.tick();
      expect(scrollNode().scrollY).toBe(0); // snapped to 0 for free
    } finally {
      runtime.stop();
    }
  });

  it("bounces the rubber-band back to 0 overscroll on release", async () => {
    const { runtime, scrollNode } = makeScrollRuntime();
    try {
      runtime.pointerDown(10, 50);
      runtime.pointerMove(10, 90); // drag down past top → overscroll
      expect(scrollNode().overscrollPx).toBeGreaterThan(0);
      runtime.pointerUp();
      // Immediately after release the settle is armed but mid-flight:
      expect(scrollNode().overscrollPx).toBeGreaterThanOrEqual(0);
      // Let the bounce-back settle complete.
      await wait(200);
      runtime.tick();
      expect(scrollNode().overscrollPx).toBe(0);
    } finally {
      runtime.stop();
    }
  });

  it("does not fling: motion stops on release (no post-lift drift)", async () => {
    const { runtime, scrollNode } = makeScrollRuntime();
    try {
      runtime.pointerDown(10, 50);
      runtime.pointerMove(10, 20); // fast drag up → scrollY = 30
      const yAtLift = scrollNode().scrollY;
      runtime.pointerUp();
      // Several frames with no input: scrollY must not drift (no fling). The
      // only post-lift motion is a bounded settle, and yAtLift=30 is well past
      // the edge-snap band so no settle is armed.
      await wait(60);
      runtime.tick();
      runtime.tick();
      expect(scrollNode().scrollY).toBe(yAtLift); // unchanged — no fling
    } finally {
      runtime.stop();
    }
  });

  it("does not acquire a scroll gesture on a non-scrollable node", () => {
    // A container whose content fits (contentHeight == box.h) is not scrollable.
    const runtime: any = new PreviewUIRuntime({
      projectRoot: "", entryFile: "", htmlFile: "", uiTreeNames: ["screen"],
      program: {
        width: 100, height: 120, colorFormat: "rgb565",
        nodes: [
          makeNode({ index: 0, tag: "screen", hasBg: true, subtreeEnd: 2, box: { x: 0, y: 0, w: 100, h: 120 } }),
          makeNode({ index: 1, tag: "view", kind: "fill", box: { x: 0, y: 10, w: 100, h: 100 }, hasBg: true, parentIndex: 0, scrollable: true, contentHeight: 100, subtreeEnd: 2 }),
        ],
        transitions: [],
      },
      font: new Uint8Array(0), bindings: [], listBindings: [], callbacks: [], initialAssignments: [], intervals: [], pinControls: [], diagnostics: [],
    } as any);
    runtime.start();
    try {
      runtime.pointerDown(10, 50);
      runtime.pointerMove(10, 30);
      expect((runtime as any).nodes[1].scrollY).toBe(0); // no scroll acquired
    } finally {
      runtime.stop();
    }
  });

  it("lets a range own diagonal drags inside a scroll container", () => {
    const runtime: any = new PreviewUIRuntime({
      projectRoot: "", entryFile: "", htmlFile: "", uiTreeNames: ["screen"],
      program: {
        width: 100, height: 120, colorFormat: "rgb565",
        nodes: [
          makeNode({ index: 0, tag: "screen", hasBg: true, subtreeEnd: 3, box: { x: 0, y: 0, w: 100, h: 120 } }),
          makeNode({
            index: 1,
            tag: "view",
            kind: "fill",
            box: { x: 0, y: 0, w: 100, h: 40 },
            hasBg: true,
            parentIndex: 0,
            scrollable: true,
            contentHeight: 100,
            subtreeEnd: 3,
          }),
          makeNode({
            index: 2,
            tag: "range",
            kind: "range",
            box: { x: 10, y: 12, w: 70, h: 20 },
            parentIndex: 1,
            subtreeEnd: 3,
            rangeMin: 0,
            rangeMax: 100,
            value: 0,
          }),
        ],
        transitions: [],
      },
      font: new Uint8Array(0), bindings: [], listBindings: [], callbacks: [], initialAssignments: [], intervals: [], pinControls: [], diagnostics: [],
    } as any);
    runtime.start();
    try {
      const scrollNode = (runtime as any).nodes[1];
      const rangeNode = (runtime as any).nodes[2];

      runtime.pointerDown(30, 20);
      const valueAfterDown = rangeNode.value;
      expect((runtime as any).scrollNode).toBe(-1);

      runtime.pointerMove(80, 35);
      expect(scrollNode.scrollY).toBe(0);
      expect(scrollNode.overscrollPx).toBe(0);
      expect(rangeNode.value).toBeGreaterThan(valueAfterDown);
    } finally {
      runtime.stop();
    }
  });

  it("preserves a moved range value after its scroll container repaints", () => {
    const runtime: any = new PreviewUIRuntime({
      projectRoot: "", entryFile: "", htmlFile: "", uiTreeNames: ["screen"],
      program: {
        width: 100, height: 120, colorFormat: "rgb565",
        nodes: [
          makeNode({ index: 0, tag: "screen", hasBg: true, subtreeEnd: 4, box: { x: 0, y: 0, w: 100, h: 120 } }),
          makeNode({
            index: 1,
            tag: "view",
            kind: "fill",
            box: { x: 0, y: 0, w: 100, h: 60 },
            hasBg: true,
            parentIndex: 0,
            scrollable: true,
            contentHeight: 140,
            subtreeEnd: 4,
          }),
          makeNode({
            index: 2,
            tag: "range",
            kind: "range",
            box: { x: 10, y: 12, w: 70, h: 20 },
            parentIndex: 1,
            subtreeEnd: 3,
            rangeMin: 0,
            rangeMax: 100,
            value: 0,
          }),
          makeNode({
            index: 3,
            tag: "view",
            kind: "fill",
            box: { x: 0, y: 90, w: 100, h: 30 },
            hasBg: true,
            parentIndex: 1,
            subtreeEnd: 4,
          }),
        ],
        transitions: [],
      },
      font: new Uint8Array(0), bindings: [], listBindings: [], callbacks: [], initialAssignments: [], intervals: [], pinControls: [], diagnostics: [],
    } as any);
    runtime.start();
    try {
      const scrollNode = (runtime as any).nodes[1];
      const rangeNode = (runtime as any).nodes[2];

      runtime.pointerDown(30, 20);
      runtime.pointerMove(70, 20);
      const movedValue = rangeNode.value;
      expect(movedValue).toBeGreaterThan(0);
      runtime.pointerUp();

      (runtime as any).lastTouchTime = -1000;
      (runtime as any).lastReleaseTime = -1000;
      runtime.pointerDown(5, 55);
      runtime.pointerMove(5, 35);

      expect(scrollNode.scrollY).toBeGreaterThan(0);
      expect(rangeNode.value).toBe(movedValue);
      expect(rangeNode.lastTextWidth).toBeGreaterThan(0);
    } finally {
      runtime.stop();
    }
  });

  it("acquires the gesture for a scroll container at a node index >= 128 (int8 overflow regression)", () => {
    // Regression: __ui_scroll_node was int8_t, so a node index of 130 wrapped
    // to -126 and the drag never armed. The scroll owner must be stored in a
    // type wide enough for any node index (the demo has 144 nodes).
    // Build a dense node array 0..130 so subtreeEnd walks are safe.
    const nodes = [];
    nodes.push(makeNode({ index: 0, tag: "screen", hasBg: true, subtreeEnd: 131, box: { x: 0, y: 0, w: 100, h: 120 } }));
    for (let i = 1; i < 130; i++) {
      nodes.push(makeNode({ index: i, tag: "view", kind: "fill", box: { x: 0, y: 0, w: 1, h: 1 }, parentIndex: 0, subtreeEnd: i + 1 }));
    }
    // The scroll container at index 130 (>= 128), with overflowing content.
    nodes.push(makeNode({ index: 130, tag: "view", kind: "fill", box: { x: 0, y: 10, w: 100, h: 100 }, hasBg: true, parentIndex: 0, scrollable: true, contentHeight: 200, subtreeEnd: 131 }));
    const runtime: any = new PreviewUIRuntime({
      projectRoot: "", entryFile: "", htmlFile: "", uiTreeNames: ["screen"],
      program: { width: 100, height: 120, colorFormat: "rgb565", nodes, transitions: [] },
      font: new Uint8Array(0), bindings: [], listBindings: [], callbacks: [], initialAssignments: [], intervals: [], pinControls: [], diagnostics: [],
    } as any);
    runtime.start();
    try {
      const node = (runtime as any).nodes[130];
      expect(node).toBeDefined();
      runtime.pointerDown(10, 50);
      runtime.pointerMove(10, 30); // drag up 20px → scrollY = 20 (1:1)
      expect(node.scrollY).toBe(20); // the int8 regression would leave this at 0
    } finally {
      runtime.stop();
    }
  });
});
