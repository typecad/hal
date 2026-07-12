import { describe, it, expect } from "vitest";
import { PreviewUIRuntime } from "@typecad/ui/preview/host-ui-runtime";
import { resolveColor } from "@typecad/ui/ui-engine/color";
import type { PreviewSnapshot } from "@typecad/ui/preview/types";

// ctx.rgbBitmap(x, y, data, w, h) blits an RGB565 pixel array onto the canvas.
// The runtime lowers it to ui_display_draw_rgb_bitmap (canvas-lowering.ts:94),
// so a draw callback that uses it renders on hardware. The preview's
// runCanvasBody regex used to enumerate only 11 ctx methods and dropped
// rgbBitmap silently — so any canvas callback using it rendered on hardware
// but not in the browser. This locks down the fix: rgbBitmap pixels land in
// the preview framebuffer at the requested offset.

const W = 8;
const H = 4;
// Two distinguishable colors so we can assert placement, not just presence.
// Stored as the runtime-format RGB565 ints that authors pass to rgbBitmap; the
// preview's gfx snaps them into its Uint32Array framebuffer.
const RED = resolveColor("#ff0000", "rgb565") & 0xffff;
const GREEN = resolveColor("#00ff00", "rgb565") & 0xffff;

function makeSnapshot(drawBody: string): PreviewSnapshot {
  return {
    projectRoot: "",
    entryFile: "",
    htmlFile: "",
    uiTreeNames: ["screen"],
    program: {
      width: W, height: H, colorFormat: "rgb565",
      display: { rotation: 0 } as never,
      nodes: [
        {
          index: 0, tag: "screen", id: "home", classes: [],
          box: { x: 0, y: 0, w: W, h: H }, bg: 0, fg: 0xffff,
          kind: "fill", textBuffer: "", parentIndex: 255,
          subtreeEnd: 2, screenId: 0, visible: true,
        } as never,
        {
          index: 1, tag: "canvas", id: "cv", classes: [],
          box: { x: 0, y: 0, w: W, h: H }, bg: 0, fg: 0xffff,
          kind: "canvas", canvasW: W, canvasH: H, value: 0,
          textBuffer: "", parentIndex: 0, subtreeEnd: 2,
          screenId: 0, visible: true,
        } as never,
      ],
      transitions: [],
    },
    font: new Array(1280).fill(0),
    bindings: [], listBindings: [], callbacks: [], initialAssignments: [],
    intervals: [], pinControls: [],
    canvasBindings: [{ nodeId: "cv", nodeIndex: 1, drawBody }],
    moduleVars: [], diagnostics: [],
  } as unknown as PreviewSnapshot;
}

describe("preview: ctx.rgbBitmap blits RGB565 pixels into the framebuffer", () => {
  it("renders an inline pixel array at the given offset", () => {
    const rt = new PreviewUIRuntime(
      makeSnapshot(`ctx.rgbBitmap(2, 1, [${RED}, ${GREEN}], 2, 1)`),
      { onFrame: () => {}, onDiagnostics: () => {} },
    );
    rt.start();
    try {
      const buf = rt.gfx.buffer;
      // The 2x1 bitmap at (2,1): pixel (2,1)=RED, pixel (3,1)=GREEN.
      const idx = (x: number, y: number) => y * W + x;
      expect(buf[idx(2, 1)] & 0xffff).toBe(RED);
      expect(buf[idx(3, 1)] & 0xffff).toBe(GREEN);
      // Surrounding pixels are untouched (the screen clear color, 0).
      expect(buf[idx(0, 0)]).toBe(0);
    } finally {
      rt.stop();
    }
  });

  it("renders pixels from a module-scoped array variable", () => {
    // data is a 2x2 block: top row red, bottom row green.
    const snapshot = makeSnapshot("ctx.rgbBitmap(0, 0, pixels, 2, 2)");
    snapshot.moduleVars = [{ name: "pixels", initializer: `[${RED}, ${RED}, ${GREEN}, ${GREEN}]` }];
    const rt = new PreviewUIRuntime(snapshot, {
      onFrame: () => {}, onDiagnostics: () => {},
    });
    rt.start();
    try {
      const buf = rt.gfx.buffer;
      const at = (x: number, y: number) => buf[y * W + x] & 0xffff;
      expect(at(0, 0)).toBe(RED);
      expect(at(1, 0)).toBe(RED);
      expect(at(0, 1)).toBe(GREEN);
      expect(at(1, 1)).toBe(GREEN);
    } finally {
      rt.stop();
    }
  });
});
