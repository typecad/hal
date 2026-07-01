import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { HostAdafruitGFX, rgb565ToRgb888 } from "../../../packages/cuttlefish/src/preview/host-gfx";
import { PreviewUIRuntime } from "../../../packages/cuttlefish/src/preview/host-ui-runtime";

function loadFont(): Uint8Array {
  const source = fs.readFileSync(path.resolve("demo-ui/lib/Adafruit_GFX_Library/glcdfont.c"), "utf-8");
  const match = /font\[\]\s+PROGMEM\s*=\s*\{([\s\S]*?)\};/.exec(source);
  const bytes = [...(match?.[1] ?? source).matchAll(/0x([0-9a-fA-F]{1,2})/g)].map((m) => parseInt(m[1], 16));
  return new Uint8Array(bytes.slice(0, 1280));
}

describe("HostAdafruitGFX", () => {
  it("draws clipped filled rectangles and lines into an RGB565 framebuffer", () => {
    const gfx = new HostAdafruitGFX(8, 8);
    gfx.fillRect(2, 2, 3, 2, 0x07e0);
    gfx.drawLine(0, 0, 3, 3, 0xf800);

    expect(gfx.buffer[2 * 8 + 2]).toBe(0xf800);
    expect(gfx.buffer[2 * 8 + 4]).toBe(0x07e0);
    expect(gfx.buffer[0]).toBe(0xf800);
    expect(gfx.buffer[7 * 8 + 7]).toBe(0);
  });

  it("renders the Adafruit classic 5x7 glyph pixels", () => {
    const gfx = new HostAdafruitGFX(12, 10, loadFont());
    gfx.setCursor(0, 0);
    gfx.setTextColor(0xffff);
    gfx.setTextSize(1);
    gfx.print("A");

    expect(gfx.buffer[0 * 12 + 2]).toBe(0xffff); // A crossbar/top column bit
    expect(gfx.buffer[2 * 12 + 0]).toBe(0xffff); // left stroke
    expect(gfx.buffer[0]).toBe(0x0000);
  });

  it("keeps the small-font antialiasing halo restrained", () => {
    const gfx = new HostAdafruitGFX(12, 10, loadFont());
    gfx.drawAntialiasedText("A", 0, 0, 0xffff, 0x0000, 1);

    expect(gfx.buffer[0]).toBe(0x0841);
    expect(gfx.buffer[2]).toBe(0xef9d);
  });

  it("expands RGB565 to canvas RGBA channel values", () => {
    expect(rgb565ToRgb888(0xf800)).toEqual({ r: 255, g: 0, b: 0 });
    expect(rgb565ToRgb888(0x07e0)).toEqual({ r: 0, g: 255, b: 0 });
  });

  it("draws radio-style circles", () => {
    const gfx = new HostAdafruitGFX(20, 20);
    gfx.drawCircle(10, 10, 7, 0xffff);
    expect(gfx.buffer[3 * 20 + 10]).toBe(0xffff);
    expect(gfx.buffer[10 * 20 + 17]).toBe(0xffff);

    gfx.fillCircle(10, 10, 3, 0x07e0);
    expect(gfx.buffer[10 * 20 + 10]).toBe(0x07e0);
    expect(gfx.buffer[8 * 20 + 10]).toBe(0x07e0);
  });
});

describe("PreviewUIRuntime", () => {
  function makeNode(overrides: Record<string, unknown>) {
    return {
      index: 0,
      tag: "view",
      classes: [],
      box: { x: 0, y: 0, w: 20, h: 10 },
      bg: 0,
      fg: 0xffff,
      kind: "fill",
      textBuffer: "",
      hasTextBinding: false,
      hasBg: false,
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
      imgDataId: 255,
      objectFit: 1,
      rangeMin: 0,
      rangeMax: 100,
      maxlen: 0,
      parentIndex: -1,
      subtreeEnd: 1,
      ...overrides,
    };
  }

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function makeRuntime(
    nodes: any[],
    imageAssets: any[] = [],
    width = 8,
    height = 8,
  ): PreviewUIRuntime {
    return new PreviewUIRuntime({
      projectRoot: "",
      entryFile: "",
      htmlFile: "",
      program: {
        width,
        height,
        colorFormat: "rgb565",
        imageAssets,
        nodes,
        transitions: [],
      },
      font: [],
      bindings: [],
      listBindings: [],
      callbacks: [],
      initialAssignments: [],
      intervals: [],
      pinControls: [],
      diagnostics: [],
    } as any);
  }

  it("renders progress nodes and updates their fill incrementally", () => {
    const runtime = new PreviewUIRuntime({
      projectRoot: "",
      entryFile: "",
      htmlFile: "",
      program: {
        width: 20,
        height: 10,
        colorFormat: "rgb565",
        nodes: [
          makeNode({ index: 0, tag: "screen", hasBg: true, subtreeEnd: 2 }),
          makeNode({
            index: 1,
            id: "progress",
            tag: "progress",
            kind: "progress",
            box: { x: 2, y: 2, w: 12, h: 5 },
            fg: 0x07e0,
            hasBg: true,
            parentIndex: 0,
            value: 50,
          }),
        ],
        transitions: [],
      },
      font: [],
      bindings: [],
      listBindings: [],
      callbacks: [],
      initialAssignments: [],
      intervals: [],
      pinControls: [],
      diagnostics: [],
    } as any);

    const px = (x: number, y: number) => runtime.gfx.buffer[y * 20 + x];
    runtime.start();
    try {
      expect(px(2, 2)).toBe(0x07e0);
      expect(px(3, 3)).toBe(0x07e0);
      expect(px(7, 3)).toBe(0x07e0);
      expect(px(8, 3)).toBe(0x0000);

      runtime.screen.progress.value = 80;
      runtime.tick(16);
      expect(px(10, 3)).toBe(0x07e0);
      expect(px(11, 3)).toBe(0x0000);

      runtime.screen.progress.value = 20;
      runtime.tick(16);
      expect(px(4, 3)).toBe(0x07e0);
      expect(px(5, 3)).toBe(0x0000);
    } finally {
      runtime.stop();
    }
  });

  it("snaps short pressed color transitions in one preview frame", () => {
    const runtime = new PreviewUIRuntime({
      projectRoot: "",
      entryFile: "",
      htmlFile: "",
      program: {
        width: 20,
        height: 10,
        colorFormat: "rgb565",
        nodes: [
          makeNode({ index: 0, tag: "screen", hasBg: true, subtreeEnd: 2, box: { x: 0, y: 0, w: 20, h: 10 } }),
          makeNode({
            index: 1,
            id: "btn",
            tag: "button",
            kind: "button",
            box: { x: 2, y: 2, w: 10, h: 5 },
            bg: 0xf800,
            hasBg: true,
            parentIndex: 0,
            subtreeEnd: 2,
          }),
        ],
        transitions: [
          { node: 1, prop: "background", durationMs: 80, pressedTarget: 0x07e0, baseTarget: 0xf800 },
        ],
      },
      font: [],
      bindings: [],
      listBindings: [],
      callbacks: [],
      initialAssignments: [],
      intervals: [],
      pinControls: [],
      diagnostics: [],
    } as any);

    runtime.start();
    try {
      (runtime as any).setPressed(1, true);
      runtime.tick(16);
      expect((runtime as any).nodes[1].bg).toBe(0x07e0);
      expect((runtime as any).transitions[0].active).toBe(false);
    } finally {
      runtime.stop();
    }
  });

  it("renders object-fit contain with centered letterboxing", () => {
    const bg = 0x2222;
    const runtime = makeRuntime([
      makeNode({ index: 0, tag: "screen", hasBg: true, subtreeEnd: 2, box: { x: 0, y: 0, w: 6, h: 4 } }),
      makeNode({
        index: 1,
        tag: "img",
        kind: "img",
        box: { x: 0, y: 0, w: 6, h: 4 },
        hasBg: true,
        bg,
        parentIndex: 0,
        subtreeEnd: 2,
        imgDataId: 0,
        objectFit: 2,
      }),
    ], [{ id: "logo", width: 2, height: 2, data: [0xf800, 0x07e0, 0x001f, 0xffff] }], 6, 4);

    const px = (x: number, y: number) => runtime.gfx.buffer[y * 6 + x];
    runtime.start();
    try {
      expect(px(0, 0)).toBe(bg);
      expect(px(1, 0)).toBe(0xf800);
      expect(px(4, 0)).toBe(0x07e0);
      expect(px(5, 3)).toBe(bg);
    } finally {
      runtime.stop();
    }
  });

  it("clears transparent image letterboxing to the node clear color", () => {
    const clearColor = 0x3333;
    const runtime = makeRuntime([
      makeNode({ index: 0, tag: "screen", hasBg: true, subtreeEnd: 2, box: { x: 0, y: 0, w: 6, h: 4 } }),
      makeNode({
        index: 1,
        tag: "img",
        kind: "img",
        box: { x: 0, y: 0, w: 6, h: 4 },
        hasBg: false,
        clearColor,
        parentIndex: 0,
        subtreeEnd: 2,
        imgDataId: 0,
        objectFit: 2,
      }),
    ], [{ id: "logo", width: 2, height: 2, data: [0xf800, 0x07e0, 0x001f, 0xffff] }], 6, 4);

    const px = (x: number, y: number) => runtime.gfx.buffer[y * 6 + x];
    runtime.start();
    try {
      expect(px(0, 0)).toBe(clearColor);
      expect(px(1, 0)).toBe(0xf800);
      expect(px(5, 3)).toBe(clearColor);
    } finally {
      runtime.stop();
    }
  });

  it("renders image borders after clearing and drawing the bitmap", () => {
    const clearColor = 0x3333;
    const borderColor = 0x07e0;
    const runtime = makeRuntime([
      makeNode({ index: 0, tag: "screen", hasBg: true, subtreeEnd: 2, box: { x: 0, y: 0, w: 4, h: 4 } }),
      makeNode({
        index: 1,
        tag: "img",
        kind: "img",
        box: { x: 0, y: 0, w: 4, h: 4 },
        hasBg: false,
        clearColor,
        borderStyle: 1,
        borderWidth: 1,
        borderColor,
        parentIndex: 0,
        subtreeEnd: 2,
      }),
    ], [], 4, 4);

    const px = (x: number, y: number) => runtime.gfx.buffer[y * 4 + x];
    runtime.start();
    try {
      expect(px(0, 0)).toBe(borderColor);
      expect(px(1, 1)).toBe(clearColor);
    } finally {
      runtime.stop();
    }
  });

  it("clips object-fit cover to the image node box", () => {
    const neighbor = 0x780f;
    const runtime = makeRuntime([
      makeNode({ index: 0, tag: "screen", hasBg: true, subtreeEnd: 3, box: { x: 0, y: 0, w: 8, h: 6 } }),
      makeNode({
        index: 1,
        tag: "view",
        kind: "fill",
        box: { x: 4, y: 0, w: 2, h: 6 },
        hasBg: true,
        bg: neighbor,
        parentIndex: 0,
        subtreeEnd: 2,
      }),
      makeNode({
        index: 2,
        tag: "img",
        kind: "img",
        box: { x: 0, y: 0, w: 4, h: 6 },
        parentIndex: 0,
        subtreeEnd: 3,
        imgDataId: 0,
        objectFit: 3,
      }),
    ], [{ id: "logo", width: 2, height: 2, data: [0xf800, 0x07e0, 0x001f, 0xffff] }], 8, 6);

    const px = (x: number, y: number) => runtime.gfx.buffer[y * 8 + x];
    runtime.start();
    try {
      expect(px(0, 0)).not.toBe(0x0000);
      expect(px(3, 5)).not.toBe(0x0000);
      expect(px(4, 0)).toBe(neighbor);
      expect(px(5, 5)).toBe(neighbor);
    } finally {
      runtime.stop();
    }
  });

  it("quarter-turn rotates fitted preview images", () => {
    const runtime = makeRuntime([
      makeNode({ index: 0, tag: "screen", hasBg: true, subtreeEnd: 2, box: { x: 0, y: 0, w: 4, h: 4 } }),
      makeNode({
        index: 1,
        tag: "img",
        kind: "img",
        box: { x: 0, y: 0, w: 2, h: 3 },
        rotateDeg: 90,
        parentIndex: 0,
        subtreeEnd: 2,
        imgDataId: 0,
        objectFit: 1,
      }),
    ], [{ id: "logo", width: 2, height: 3, data: [1, 2, 3, 4, 5, 6] }], 4, 4);

    const px = (x: number, y: number) => runtime.gfx.buffer[y * 4 + x];
    runtime.start();
    try {
      expect(px(0, 0)).toBe(5);
      expect(px(1, 0)).toBe(3);
      expect(px(2, 0)).toBe(1);
      expect(px(0, 1)).toBe(6);
      expect(px(2, 1)).toBe(2);
    } finally {
      runtime.stop();
    }
  });

  it("renders and scrolls preview list bindings", async () => {
    const runtime = new PreviewUIRuntime({
      projectRoot: "",
      entryFile: "",
      htmlFile: "",
      uiTreeNames: ["screen"],
      program: {
        width: 36,
        height: 24,
        colorFormat: "rgb565",
        nodes: [
          makeNode({ index: 0, tag: "screen", hasBg: true, subtreeEnd: 3, box: { x: 0, y: 0, w: 36, h: 24 } }),
          makeNode({ index: 1, id: "selected", tag: "view", box: { x: 0, y: 0, w: 1, h: 1 }, parentIndex: 0 }),
          makeNode({
            index: 2,
            id: "devices",
            tag: "list",
            kind: "list",
            box: { x: 2, y: 2, w: 30, h: 16 },
            fg: 0x07e0,
            clearColor: 0x0000,
            parentIndex: 0,
            subtreeEnd: 3,
            listItemHeight: 8,
            scrollable: true,  // lists are scrollable (UA rule); unified scan needs this
            virtualized: true,
          }),
        ],
        transitions: [],
      },
      font: Array.from(loadFont()),
      bindings: [],
      listBindings: [{
        nodeId: "devices",
        nodeIndex: 2,
        countExpression: "6",
        itemExpression: "`Row ${i + 1}`",
        itemParam: "i",
        tapBody: "screen.selected.value = i + 1;",
        tapParam: "i",
      }],
      callbacks: [],
      initialAssignments: [],
      intervals: [],
      pinControls: [],
      diagnostics: [],
    } as any);

    runtime.start();
    try {
      const states = (runtime as any).listStates;
      const listNode = (runtime as any).nodes[2];
      expect(states[0].contentHeight).toBe(48);
      expect(listNode.contentHeight).toBe(48);  // list geometry now also on-node
      expect(runtime.gfx.buffer[2 * 36 + 30]).toBe(0x07e0);

      runtime.pointerDown(8, 16);
      runtime.pointerMove(8, 0);   // drag up 16px → scrollY=16 (past the edge-snap band)
      runtime.pointerUp();
      expect(listNode.scrollY).toBe(16);  // scroll lives on the node now

      await wait(60);
      runtime.pointerDown(8, 10);
      runtime.pointerUp();
      // scrollY=16, tap at y=10, list top at y=2, itemHeight=8:
      // row = (10 - 2 + 16) / 8 = 3 → value = row + 1 = 4.
      expect(runtime.screen.selected.value).toBe(4);
    } finally {
      runtime.stop();
    }
  });

  it("clips preview list row text to the list box", () => {
    const runtime = new PreviewUIRuntime({
      projectRoot: "",
      entryFile: "",
      htmlFile: "",
      uiTreeNames: ["screen"],
      program: {
        width: 24,
        height: 24,
        colorFormat: "rgb565",
        nodes: [
          makeNode({
            index: 0,
            tag: "screen",
            kind: "fill",
            hasBg: true,
            bg: 0xf800,
            subtreeEnd: 2,
            box: { x: 0, y: 0, w: 24, h: 24 },
          }),
          makeNode({
            index: 1,
            id: "devices",
            tag: "list",
            kind: "list",
            box: { x: 2, y: 8, w: 20, h: 8 },
            fg: 0x07e0,
            clearColor: 0x0000,
            parentIndex: 0,
            subtreeEnd: 2,
            listItemHeight: 8,
            textSize: 2,
          }),
        ],
        transitions: [],
      },
      font: Array.from(loadFont()),
      bindings: [],
      listBindings: [{
        nodeId: "devices",
        nodeIndex: 1,
        countExpression: "1",
        itemExpression: '"A"',
      }],
      callbacks: [],
      initialAssignments: [],
      intervals: [],
      pinControls: [],
      diagnostics: [],
    } as any);

    const hasColor = (color: number, x0: number, y0: number, x1: number, y1: number): boolean => {
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (runtime.gfx.buffer[y * 24 + x] === color) return true;
        }
      }
      return false;
    };
    runtime.start();
    try {
      expect(hasColor(0x07e0, 2, 0, 22, 8)).toBe(false);
      expect(hasColor(0x07e0, 2, 8, 22, 16)).toBe(true);
      expect(hasColor(0x07e0, 2, 16, 22, 24)).toBe(false);
    } finally {
      runtime.stop();
    }
  });

  it("toggles preallocated conditional branches with visible bindings", () => {
    const runtime = new PreviewUIRuntime({
      projectRoot: "",
      entryFile: "",
      htmlFile: "",
      program: {
        width: 24,
        height: 18,
        colorFormat: "rgb565",
        nodes: [
          makeNode({ index: 0, tag: "screen", hasBg: true, subtreeEnd: 5, box: { x: 0, y: 0, w: 24, h: 18 } }),
          makeNode({ index: 1, id: "flag", tag: "view", box: { x: 0, y: 0, w: 1, h: 1 }, parentIndex: 0 }),
          makeNode({
            index: 2,
            id: "enteredBranch",
            tag: "view",
            kind: "fill",
            box: { x: 0, y: 0, w: 24, h: 18 },
            hasBg: true,
            bg: 0xf800,
            parentIndex: 0,
            subtreeEnd: 4,
          }),
          makeNode({
            index: 3,
            tag: "view",
            kind: "fill",
            box: { x: 2, y: 2, w: 6, h: 6 },
            hasBg: true,
            bg: 0xffff,
            parentIndex: 2,
            subtreeEnd: 4,
          }),
          makeNode({
            index: 4,
            id: "emptyBranch",
            tag: "view",
            kind: "fill",
            box: { x: 0, y: 0, w: 24, h: 18 },
            hasBg: true,
            bg: 0x07e0,
            parentIndex: 0,
            subtreeEnd: 5,
          }),
        ],
        transitions: [],
      },
      font: [],
      bindings: [
        { nodeId: "enteredBranch", nodeIndex: 2, property: "visible", expression: "screen.flag.value > 0" },
        { nodeId: "emptyBranch", nodeIndex: 4, property: "visible", expression: "screen.flag.value <= 0" },
      ],
      listBindings: [],
      callbacks: [],
      initialAssignments: [],
      intervals: [],
      pinControls: [],
      diagnostics: [],
    } as any);

    const px = (x: number, y: number) => runtime.gfx.buffer[y * 24 + x];
    runtime.start();
    try {
      expect(px(2, 2)).toBe(0x07e0);

      const clearNodePaint = vi.spyOn(runtime as any, "clearCurrentNodePaint");
      const clearSubtreePaint = vi.spyOn(runtime as any, "clearCurrentSubtreePaint");

      runtime.screen.flag.value = 1;
      runtime.tick(16);
      expect(clearSubtreePaint).toHaveBeenCalled();
      expect(clearNodePaint).not.toHaveBeenCalled();
      expect(px(2, 2)).toBe(0xffff);
      expect(px(12, 10)).toBe(0xf800);

      runtime.screen.flag.value = 0;
      runtime.tick(16);
      expect(px(2, 2)).toBe(0x07e0);
      expect(px(12, 10)).toBe(0x07e0);
    } finally {
      runtime.stop();
    }
  });

  it("repairs higher z-index layers after hiding an overflowing visible subtree", () => {
    const runtime = new PreviewUIRuntime({
      projectRoot: "",
      entryFile: "",
      htmlFile: "",
      program: {
        width: 20,
        height: 10,
        colorFormat: "rgb565",
        nodes: [
          makeNode({ index: 0, tag: "screen", hasBg: true, subtreeEnd: 5, box: { x: 0, y: 0, w: 20, h: 10 } }),
          makeNode({ index: 1, id: "flag", tag: "view", box: { x: 0, y: 0, w: 1, h: 1 }, parentIndex: 0 }),
          makeNode({
            index: 2,
            id: "branch",
            tag: "view",
            kind: "fill",
            box: { x: 0, y: 0, w: 4, h: 4 },
            hasBg: true,
            bg: 0xf800,
            parentIndex: 0,
            subtreeEnd: 4,
          }),
          makeNode({
            index: 3,
            tag: "view",
            kind: "fill",
            box: { x: 8, y: 0, w: 8, h: 8 },
            hasBg: true,
            bg: 0x07e0,
            parentIndex: 2,
            subtreeEnd: 4,
          }),
          makeNode({
            index: 4,
            id: "overlay",
            tag: "view",
            kind: "fill",
            box: { x: 10, y: 2, w: 5, h: 5 },
            hasBg: true,
            bg: 0x001f,
            parentIndex: 0,
            subtreeEnd: 5,
            zIndex: 10,
          }),
        ],
        transitions: [],
      },
      font: [],
      bindings: [
        { nodeId: "branch", nodeIndex: 2, property: "visible", expression: "screen.flag.value === 0" },
      ],
      listBindings: [],
      callbacks: [],
      initialAssignments: [],
      intervals: [],
      pinControls: [],
      diagnostics: [],
    } as any);

    const px = (x: number, y: number) => runtime.gfx.buffer[y * 20 + x];
    runtime.start();
    try {
      expect(px(11, 3)).toBe(0x001f);

      runtime.screen.flag.value = 1;
      runtime.tick(16);

      expect(px(11, 3)).toBe(0x001f);
      expect(px(8, 1)).toBe(0x0000);
    } finally {
      runtime.stop();
    }
  });

  it("renders antialiased text with blended edge pixels", () => {
    const runtime = new PreviewUIRuntime({
      projectRoot: "",
      entryFile: "",
      htmlFile: "",
      program: {
        width: 24,
        height: 12,
        colorFormat: "rgb565",
        nodes: [
          makeNode({ index: 0, tag: "screen", hasBg: true, subtreeEnd: 2, box: { x: 0, y: 0, w: 24, h: 12 } }),
          makeNode({
            index: 1,
            tag: "text",
            kind: "text",
            text: "A",
            box: { x: 0, y: 0, w: 12, h: 8 },
            fg: 0xffff,
            clearColor: 0x0000,
            parentIndex: 0,
            textSize: 1,
            fontAntialias: true,
          }),
        ],
        transitions: [],
      },
      font: Array.from(loadFont()),
      bindings: [],
      listBindings: [],
      callbacks: [],
      initialAssignments: [],
      intervals: [],
      pinControls: [],
      diagnostics: [],
    } as any);

    runtime.start();
    try {
      expect(Array.from(runtime.gfx.buffer).some((px) => px !== 0x0000 && px !== 0xffff)).toBe(true);
    } finally {
      runtime.stop();
    }
  });

  it("renders generated alpha font assets", () => {
    const runtime = new PreviewUIRuntime({
      projectRoot: "",
      entryFile: "",
      htmlFile: "",
      program: {
        width: 8,
        height: 4,
        colorFormat: "rgb565",
        fontAssets: [{
          id: 1,
          family: "Tiny",
          sourcePath: "tiny.ttf",
          px: 16,
          lineHeight: 2,
          baseline: 1,
          glyphs: [{ codepoint: 65, xOffset: 0, yOffset: -1, width: 1, height: 1, advance: 2, dataOffset: 0 }],
          alpha: [0x80],
        }],
        nodes: [
          makeNode({ index: 0, tag: "screen", hasBg: true, subtreeEnd: 2, box: { x: 0, y: 0, w: 8, h: 4 } }),
          makeNode({
            index: 1,
            tag: "text",
            kind: "text",
            text: "A",
            box: { x: 0, y: 0, w: 8, h: 2 },
            fg: 0xffff,
            clearColor: 0x0000,
            parentIndex: 0,
            fontAntialias: true,
            fontFace: 1,
          }),
        ],
        transitions: [],
      },
      font: [],
      bindings: [],
      listBindings: [],
      callbacks: [],
      initialAssignments: [],
      intervals: [],
      pinControls: [],
      diagnostics: [],
    } as any);

    runtime.start();
    try {
      expect(runtime.gfx.buffer[0]).not.toBe(0x0000);
      expect(runtime.gfx.buffer[0]).not.toBe(0xffff);
    } finally {
      runtime.stop();
    }
  });

  it("clips partially visible scroll children instead of skipping them", () => {
    const runtime = new PreviewUIRuntime({
      projectRoot: "",
      entryFile: "",
      htmlFile: "",
      program: {
        width: 10,
        height: 8,
        colorFormat: "rgb565",
        nodes: [
          makeNode({ index: 0, tag: "screen", hasBg: true, box: { x: 0, y: 0, w: 10, h: 8 }, subtreeEnd: 3 }),
          makeNode({
            index: 1,
            tag: "view",
            kind: "fill",
            box: { x: 0, y: 0, w: 10, h: 6 },
            hasBg: true,
            bg: 0x0000,
            parentIndex: 0,
            scrollable: true,
            scrollY: 5,
            contentHeight: 12,
            subtreeEnd: 3,
          }),
          makeNode({
            index: 2,
            tag: "view",
            kind: "fill",
            box: { x: 0, y: 2, w: 10, h: 8 },
            hasBg: true,
            bg: 0x07e0,
            parentIndex: 1,
            subtreeEnd: 3,
          }),
        ],
        transitions: [],
      },
      font: [],
      bindings: [],
      listBindings: [],
      callbacks: [],
      initialAssignments: [],
      intervals: [],
      pinControls: [],
      diagnostics: [],
    } as any);

    runtime.start();
    try {
      expect(runtime.gfx.buffer[0 * 10 + 1]).toBe(0x07e0);
      expect(runtime.gfx.buffer[4 * 10 + 1]).toBe(0x07e0);
      expect(runtime.gfx.buffer[6 * 10 + 1]).toBe(0x0000);
    } finally {
      runtime.stop();
    }
  });

  it("repairs cleared transform pixels with the rounded parent fill in browser preview", () => {
    const screenBg = 0xffff;
    const trackBg = 0x4208;
    const dotBg = 0xf800;
    const runtime = makeRuntime([
      makeNode({
        index: 0,
        tag: "screen",
        kind: "fill",
        box: { x: 0, y: 0, w: 14, h: 12 },
        hasBg: true,
        bg: screenBg,
        clearColor: screenBg,
        subtreeEnd: 4,
      }),
      makeNode({
        index: 1,
        tag: "view",
        kind: "fill",
        box: { x: 0, y: 0, w: 14, h: 12 },
        hasBg: true,
        bg: screenBg,
        clearColor: screenBg,
        parentIndex: 0,
        subtreeEnd: 4,
        scrollable: true,
      }),
      makeNode({
        index: 2,
        id: "track",
        tag: "view",
        kind: "fill",
        box: { x: 2, y: 2, w: 8, h: 6 },
        hasBg: true,
        bg: trackBg,
        clearColor: screenBg,
        borderRadius: 3,
        parentIndex: 1,
        subtreeEnd: 4,
      }),
      makeNode({
        index: 3,
        id: "dot",
        tag: "view",
        kind: "fill",
        box: { x: 2, y: 2, w: 2, h: 2 },
        hasBg: true,
        bg: dotBg,
        clearColor: screenBg,
        parentIndex: 2,
        subtreeEnd: 4,
      }),
    ], [], 14, 12);

    const px = (x: number, y: number) => runtime.gfx.buffer[y * 14 + x];
    runtime.start();
    try {
      expect(px(2, 2)).toBe(dotBg);
      (runtime as any).clearCurrentNodePaint((runtime as any).nodes[3]);
      expect(px(2, 2)).toBe(screenBg);
      expect(px(5, 2)).toBe(trackBg);
    } finally {
      runtime.stop();
    }
  });

  it("repairs animated transform fills in preview without the old 100ms geometry throttle", () => {
    const onFrame = vi.fn();
    const runtime = new PreviewUIRuntime({
      projectRoot: "",
      entryFile: "",
      htmlFile: "",
      program: {
        width: 16,
        height: 12,
        colorFormat: "rgb565",
        nodes: [
          makeNode({
            index: 0,
            tag: "screen",
            kind: "fill",
            box: { x: 0, y: 0, w: 16, h: 12 },
            hasBg: true,
            bg: 0xffff,
            clearColor: 0xffff,
            subtreeEnd: 4,
          }),
          makeNode({
            index: 1,
            tag: "view",
            kind: "fill",
            box: { x: 0, y: 0, w: 16, h: 8 },
            hasBg: true,
            bg: 0xffff,
            clearColor: 0xffff,
            parentIndex: 0,
            scrollable: true,
            contentHeight: 24,
            subtreeEnd: 4,
          }),
          makeNode({
            index: 2,
            tag: "view",
            kind: "fill",
            box: { x: 1, y: 1, w: 12, h: 4 },
            hasBg: true,
            bg: 0x4208,
            clearColor: 0xffff,
            parentIndex: 1,
            subtreeEnd: 4,
          }),
          makeNode({
            index: 3,
            id: "dot",
            tag: "view",
            kind: "fill",
            box: { x: 1, y: 1, w: 2, h: 2 },
            hasBg: true,
            bg: 0xf800,
            clearColor: 0xffff,
            parentIndex: 2,
            subtreeEnd: 4,
          }),
        ],
        transitions: [],
        keyframeSets: [
          {
            name: "move",
            stops: [
              {
                percent: 0,
                props: 8,
                bg: 0,
                fg: 0,
                opacity: 100,
                transformOffsetX: 0,
                transformOffsetY: 0,
                translatePctX: 0,
                translatePctY: 0,
                scaleX: 100,
                scaleY: 100,
                rotateDeg: 0,
                width: 0,
                height: 0,
              },
              {
                percent: 100,
                props: 8,
                bg: 0,
                fg: 0,
                opacity: 100,
                transformOffsetX: 50,
                transformOffsetY: 0,
                translatePctX: 0,
                translatePctY: 0,
                scaleX: 100,
                scaleY: 100,
                rotateDeg: 0,
                width: 0,
                height: 0,
              },
            ],
          },
        ],
        animations: [
          {
            node: 3,
            keyframeSet: 0,
            durationMs: 1000,
            delayMs: 0,
            iterations: -1,
            baseWidth: 2,
            baseHeight: 2,
            originX: 0,
            originY: 0,
            timingFunction: 0,
          },
        ],
      },
      font: [],
      bindings: [],
      listBindings: [],
      callbacks: [],
      initialAssignments: [],
      intervals: [],
      pinControls: [],
      diagnostics: [],
    } as any, { onFrame });

    runtime.start();
    try {
      const clearNodePaint = vi.spyOn(runtime as any, "clearCurrentNodePaint");
      const markScrollViewDirty = vi.spyOn(runtime as any, "markScrollViewDirty");
      const repairGeometryFill = vi.spyOn(runtime as any, "tryRepairGeometryFill");
      const px = (x: number, y: number) => runtime.gfx.buffer[y * 16 + x];

      expect(px(1, 1)).toBe(0xf800);

      runtime.tick(40);

      expect(clearNodePaint).not.toHaveBeenCalled();
      expect(markScrollViewDirty).not.toHaveBeenCalled();
      expect(repairGeometryFill).toHaveBeenCalled();
      expect((runtime as any).nodes[3].transformOffsetX).toBeGreaterThan(0);
      expect(px(1, 1)).toBe(0x4208);
      expect(px(3, 1)).toBe(0xf800);
      expect(onFrame).toHaveBeenCalled();
    } finally {
      runtime.stop();
    }
  });

  it("repairs pressed-offset clears with the rounded parent fill in browser preview", () => {
    const screenBg = 0xffff;
    const trackBg = 0x4208;
    const buttonBg = 0xf800;
    const runtime = makeRuntime([
      makeNode({
        index: 0,
        tag: "screen",
        kind: "fill",
        box: { x: 0, y: 0, w: 14, h: 12 },
        hasBg: true,
        bg: screenBg,
        clearColor: screenBg,
        subtreeEnd: 4,
      }),
      makeNode({
        index: 1,
        tag: "view",
        kind: "fill",
        box: { x: 0, y: 0, w: 14, h: 12 },
        hasBg: true,
        bg: screenBg,
        clearColor: screenBg,
        parentIndex: 0,
        subtreeEnd: 4,
      }),
      makeNode({
        index: 2,
        id: "track",
        tag: "view",
        kind: "fill",
        box: { x: 2, y: 2, w: 8, h: 6 },
        hasBg: true,
        bg: trackBg,
        clearColor: screenBg,
        borderRadius: 3,
        parentIndex: 1,
        subtreeEnd: 4,
      }),
      makeNode({
        index: 3,
        id: "button",
        tag: "button",
        kind: "button",
        box: { x: 2, y: 2, w: 4, h: 2 },
        hasBg: true,
        bg: buttonBg,
        clearColor: screenBg,
        pressedOffsetY: 2,
        parentIndex: 2,
        subtreeEnd: 4,
      }),
    ], [], 14, 12);

    const px = (x: number, y: number) => runtime.gfx.buffer[y * 14 + x];
    runtime.start();
    try {
      expect(px(2, 2)).toBe(buttonBg);
      (runtime as any).clearPressOffsetArea((runtime as any).nodes[3], 2, 2);
      expect(px(2, 2)).not.toBe(buttonBg);
      expect(px(5, 2)).toBe(trackBg);
    } finally {
      runtime.stop();
    }
  });

  it("snaps a pulled-past-top scroll view back to scrollY zero on release", async () => {
    const runtime = new PreviewUIRuntime({
      projectRoot: "",
      entryFile: "",
      htmlFile: "",
      program: {
        width: 24,
        height: 32,
        colorFormat: "rgb565",
        nodes: [
          makeNode({ index: 0, tag: "screen", hasBg: true, box: { x: 0, y: 0, w: 24, h: 32 }, subtreeEnd: 4 }),
          makeNode({
            index: 1,
            tag: "view",
            kind: "fill",
            box: { x: 0, y: 0, w: 24, h: 20 },
            hasBg: true,
            bg: 0x0000,
            parentIndex: 0,
            scrollable: true,
            scrollY: 8,
            contentHeight: 60,
            subtreeEnd: 4,
          }),
          makeNode({
            index: 2,
            tag: "view",
            kind: "fill",
            box: { x: 0, y: 0, w: 24, h: 14 },
            hasBg: true,
            bg: 0x07e0,
            parentIndex: 1,
            subtreeEnd: 3,
          }),
          makeNode({
            index: 3,
            tag: "view",
            kind: "fill",
            box: { x: 0, y: 30, w: 24, h: 14 },
            hasBg: true,
            bg: 0xf800,
            parentIndex: 1,
            subtreeEnd: 4,
          }),
        ],
        transitions: [],
      },
      font: [],
      bindings: [],
      listBindings: [],
      callbacks: [],
      initialAssignments: [],
      intervals: [],
      pinControls: [],
      diagnostics: [],
    } as any);

    runtime.start();
    try {
      const scrollNode = (runtime as any).nodes[1];
      expect(scrollNode.scrollY).toBe(8);

      runtime.pointerDown(4, 4);
      runtime.pointerMove(4, 24);
      // Pulling past the top arms a rubber-band overscroll (scrollY clamps to 0,
      // overscrollPx grows) — not a synchronous snap.
      expect(scrollNode.scrollY).toBe(0);
      expect(scrollNode.overscrollPx).toBeGreaterThan(0);
      runtime.pointerUp();
      // On release a bounded settle animation bounces overscroll back to 0.
      // Let it complete (UI_SCROLL_SETTLE_MS), then the content rests at scrollY 0.
      await wait(200);
      runtime.tick();

      expect(scrollNode.scrollY).toBe(0);
      expect(scrollNode.overscrollPx).toBe(0);
      expect(runtime.gfx.buffer[2 * 24 + 2]).toBe(0x07e0);
    } finally {
      runtime.stop();
    }
  });

  it("does not snap normal scroll-down gestures that start at the top", () => {
    const runtime = new PreviewUIRuntime({
      projectRoot: "",
      entryFile: "",
      htmlFile: "",
      program: {
        width: 24,
        height: 32,
        colorFormat: "rgb565",
        nodes: [
          makeNode({ index: 0, tag: "screen", hasBg: true, box: { x: 0, y: 0, w: 24, h: 32 }, subtreeEnd: 3 }),
          makeNode({
            index: 1,
            tag: "view",
            kind: "fill",
            box: { x: 0, y: 0, w: 24, h: 20 },
            hasBg: true,
            bg: 0x0000,
            parentIndex: 0,
            scrollable: true,
            scrollY: 0,
            contentHeight: 60,
            subtreeEnd: 3,
          }),
          makeNode({
            index: 2,
            tag: "view",
            kind: "fill",
            box: { x: 0, y: 30, w: 24, h: 14 },
            hasBg: true,
            bg: 0xf800,
            parentIndex: 1,
            subtreeEnd: 3,
          }),
        ],
        transitions: [],
      },
      font: [],
      bindings: [],
      listBindings: [],
      callbacks: [],
      initialAssignments: [],
      intervals: [],
      pinControls: [],
      diagnostics: [],
    } as any);

    runtime.start();
    try {
      const scrollNode = (runtime as any).nodes[1];
      runtime.pointerDown(4, 18);
      runtime.pointerMove(4, 4);
      runtime.pointerUp();

      expect(scrollNode.scrollY).toBe(14);
    } finally {
      runtime.stop();
    }
  });

  it("does not open the preview keyboard when dragging from an input inside a scroll container", () => {
    const runtime = new PreviewUIRuntime({
      projectRoot: "",
      entryFile: "",
      htmlFile: "",
      program: {
        width: 100,
        height: 80,
        colorFormat: "rgb565",
        nodes: [
          makeNode({ index: 0, tag: "screen", hasBg: true, subtreeEnd: 3, box: { x: 0, y: 0, w: 100, h: 80 } }),
          makeNode({
            index: 1,
            tag: "view",
            kind: "fill",
            box: { x: 0, y: 0, w: 100, h: 40 },
            parentIndex: 0,
            subtreeEnd: 3,
            scrollable: true,
            contentHeight: 100,
          }),
          makeNode({
            index: 2,
            id: "ssid",
            tag: "input",
            kind: "input",
            box: { x: 5, y: 18, w: 52, h: 20 },
            parentIndex: 1,
            subtreeEnd: 3,
            inputType: "text",
          }),
        ],
        transitions: [],
      },
      keyboardTemplates: [],
      font: [],
      bindings: [],
      listBindings: [],
      callbacks: [],
      initialAssignments: [],
      intervals: [],
      pinControls: [],
      diagnostics: [],
    } as any);

    runtime.start();
    try {
      const scrollNode = (runtime as any).nodes[1];
      runtime.pointerDown(8, 20);
      runtime.pointerMove(8, 4);
      runtime.pointerUp();

      expect(scrollNode.scrollY).toBe(16);
      expect((runtime as any).keyboardVisible).toBe(false);
    } finally {
      runtime.stop();
    }
  });

  it("renders input fields and commits text through the preview keyboard", async () => {
    const runtime = new PreviewUIRuntime({
      projectRoot: "",
      entryFile: "",
      htmlFile: "",
      program: {
        width: 100,
        height: 80,
        colorFormat: "rgb565",
        nodes: [
          makeNode({ index: 0, tag: "screen", hasBg: true, subtreeEnd: 2, box: { x: 0, y: 0, w: 100, h: 80 } }),
          makeNode({
            index: 1,
            id: "ssid",
            tag: "input",
            kind: "input",
            box: { x: 5, y: 5, w: 52, h: 20 },
            fg: 0x07e0,
            borderColor: 0x07e0,
            parentIndex: 0,
            placeholder: "SSID",
            maxlen: 4,
            inputType: "text",
          }),
        ],
        transitions: [],
      },
      keyboardTemplates: [],
      cssRules: [
        { selector: { compounds: [[{ kind: "class", name: "ui-keyboard" }]] }, properties: { background: "black" } },
        { selector: { compounds: [[{ kind: "class", name: "ui-key" }]] }, properties: { background: "red", color: "white", borderColor: "red" } },
      ],
      font: [],
      bindings: [],
      listBindings: [],
      callbacks: [
        { nodeId: "ssid", nodeIndex: 1, kind: "change", body: "screen.ssid.value = screen.ssid.text.length;" },
      ],
      initialAssignments: [],
      intervals: [],
      pinControls: [],
      diagnostics: [],
    } as any);

    const px = (x: number, y: number) => runtime.gfx.buffer[y * 100 + x];
    runtime.start();
    try {
      expect(px(5, 5)).toBe(0x07e0);

      runtime.pointerDown(8, 8);
      runtime.pointerUp();
      await wait(60);
      expect(px(2, 46)).toBe(0xf800);

      runtime.pointerDown(3, 47);
      runtime.pointerUp();
      await wait(60);
      runtime.pointerDown(84, 74);
      runtime.pointerUp();

      expect(runtime.screen.ssid.text).toBe("1");
      expect(runtime.screen.ssid.value).toBe(1);
    } finally {
      runtime.stop();
    }
  });
});
