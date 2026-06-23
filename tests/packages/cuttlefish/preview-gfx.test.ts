import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HostAdafruitGFX, rgb565ToRgb888 } from "@typecad/cuttlefish/preview/host-gfx";
import { PreviewUIRuntime } from "@typecad/cuttlefish/preview/host-ui-runtime";

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
      borderColor: 0,
      borderStyle: 0,
      underline: false,
      visible: true,
      clearColor: 0,
      lastTextWidth: 0,
      dirty: false,
      value: 0,
      scrollable: false,
      scrollY: 0,
      contentHeight: 0,
      parentIndex: -1,
      subtreeEnd: 1,
      ...overrides,
    };
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
});
