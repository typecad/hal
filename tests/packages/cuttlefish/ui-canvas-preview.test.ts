// Preview side of <canvas>: the host runtime draws the canvas body into the
// node's box. See docs/superpowers/specs/2026-06-27-canvas-element-design.md

import { describe, expect, it } from "vitest";
import { PreviewUIRuntime } from "@typecad/ui/preview/host-ui-runtime";

function makeNode(overrides: Record<string, unknown>) {
  return {
    index: 0, tag: "view", classes: [],
    box: { x: 0, y: 0, w: 20, h: 10 }, bg: 0, fg: 0xffff,
    kind: "fill", textBuffer: "", parentIndex: 255,
    subtreeEnd: 1, screenId: 0, visible: true,
    canvasW: 0, canvasH: 0, ...overrides,
  };
}

describe("canvas preview", () => {
  it("draws a canvas node's body into its box without throwing", () => {
    const nodes = [
      makeNode({ index: 0, tag: "screen", hasBg: true, subtreeEnd: 2, box: { x: 0, y: 0, w: 40, h: 30 } }),
      makeNode({ index: 1, id: "spark", tag: "canvas", kind: "canvas", box: { x: 2, y: 2, w: 20, h: 20 }, canvasW: 20, canvasH: 20, parentIndex: 0, subtreeEnd: 2 }),
    ];
    const runtime = new PreviewUIRuntime({
      projectRoot: "", entryFile: "", htmlFile: "", uiTreeNames: ["screen"],
      program: { width: 40, height: 30, colorFormat: "rgb565", nodes, transitions: [] },
      font: new Array(1280).fill(0),
      bindings: [], listBindings: [], callbacks: [],
      canvasBindings: [{ nodeId: "spark", nodeIndex: 1, drawBody: "ctx.fillRect(0,0,5,5,'red'); ctx.line(0,0,ctx.width,ctx.height,'limegreen');" }],
      initialAssignments: [], intervals: [], pinControls: [], diagnostics: [],
    } as any);
    runtime.start();
    try {
      // tick once → the canvas draws without throwing and the node is no longer dirty.
      expect(() => runtime.tick()).not.toThrow();
      expect((runtime as any).nodes[1].dirty).toBe(false);
    } finally {
      runtime.stop();
    }
  });
});
