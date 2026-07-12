import { describe, it, expect } from "vitest";
import { PreviewUIRuntime } from "@typecad/ui/preview/host-ui-runtime";
import { resolveColor } from "@typecad/ui/ui-engine/color";
import type { PreviewSnapshot } from "@typecad/ui/preview/types";

// A canvas draw body can read dynamic values: e.g.
//   ctx.line(0, h/2, screen.needle.value, h/2, 'red')
// The device emits these as real C++ expressions evaluated each frame
// (`__ui_nodes[i].value`). The preview's canvas-body evaluator used to
// parseInt() each argument, so `screen.needle.value` became NaN→0 and the
// drawn line was frozen regardless of the advancing value. This locks down
// that the line actually moves as the driving interval fires.
//
// The fixture is self-contained (no demo coupling): a single canvas node
// advances its own `.value` via an interval, and its draw body draws a red
// horizontal line from a fixed left pivot (x=0) to a tip at `screen.needle.value`.
// As the value advances, the red pixels' max-x grows, so the early-vs-late span
// differs — a frozen evaluator (the bug) keeps an identical span.

const W = 48;
const H = 16;
const RED = resolveColor("#ff5577", "rgb565") & 0xffff;

function redPixelMaxX(buffer: Uint16Array): number {
  let maxX = -1;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === RED) {
      const x = i % W;
      if (x > maxX) maxX = x;
    }
  }
  return maxX;
}

function makeSnapshot(): PreviewSnapshot {
  // Canvas node (index 1) is a child of the screen (index 0). Its draw body
  // draws a red line from (0, h/2) to (screen.needle.value, h/2). The interval
  // advances screen.needle.value, which marks the canvas node dirty (via the
  // screen proxy's value setter) so the body re-runs next frame.
  return {
    projectRoot: "",
    entryFile: "",
    htmlFile: "",
    uiTreeNames: ["screen"],
    program: {
      width: W,
      height: H,
      colorFormat: "rgb565",
      nodes: [
        {
          index: 0, tag: "screen", id: "home", classes: [],
          box: { x: 0, y: 0, w: W, h: H }, bg: 0, fg: 0xffff,
          kind: "fill", textBuffer: "", parentIndex: 255,
          subtreeEnd: 2, screenId: 0, visible: true,
        },
        {
          index: 1, tag: "canvas", id: "needle", classes: [],
          box: { x: 0, y: 0, w: W, h: H }, bg: 0, fg: 0xffff,
          kind: "canvas", canvasW: W, canvasH: H, value: 0,
          textBuffer: "", parentIndex: 0, subtreeEnd: 2,
          screenId: 0, visible: true,
        },
      ],
      transitions: [],
    },
    font: new Array(1280).fill(0),
    bindings: [], listBindings: [], callbacks: [],
    // Start the tip at x=4; the interval grows it so the line extends.
    initialAssignments: [{ nodeId: "needle", nodeIndex: 1, expression: "4" }],
    intervals: [{ body: "screen.needle.value = screen.needle.value + 6;", delayMs: 4 }],
    pinControls: [],
    // Red line from the left pivot to the (moving) tip x. y is the canvas
    // vertical center. The dynamic arg is `screen.needle.value` — the case the
    // parseInt()-only evaluator used to freeze at 0.
    canvasBindings: [{
      nodeId: "needle", nodeIndex: 1,
      drawBody: `ctx.line(0, ${H / 2}, screen.needle.value, ${H / 2}, '#ff5577');`,
    }],
    moduleVars: [],
    diagnostics: [],
  } as unknown as PreviewSnapshot;
}

describe("preview canvas: dynamic arguments redraw each frame", () => {
  it("the drawn line extends as screen.needle.value advances", async () => {
    const rt = new PreviewUIRuntime(makeSnapshot(), {
      onFrame: () => {},
      onDiagnostics: () => {},
    });
    rt.start();
    try {
      const buffer = () => (rt as unknown as { gfx: { buffer: Uint16Array } }).gfx.buffer;
      const early = redPixelMaxX(buffer());

      // Let the driving setInterval advance the value several times.
      await new Promise((resolve) => setTimeout(resolve, 40));
      rt.tick();
      const late = redPixelMaxX(buffer());

      // The line's tip follows screen.needle.value, so red pixels must reach
      // further right after the interval has fired. A frozen evaluator (the
      // bug) keeps early === late.
      expect(late).toBeGreaterThan(early);
    } finally {
      rt.stop();
    }
  }, 15000);
});
