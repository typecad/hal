import { describe, it, expect } from "vitest";
import { PreviewUIRuntime } from "@typecad/cuttlefish/preview/host-ui-runtime";
import type { PreviewSnapshot } from "@typecad/cuttlefish/preview/types";

// A bool signal interpolated in a text binding prints as 1/0 on hardware:
// numericFormat returns %d for a bool signal (text-binding-lowering tests),
// so snprintf writes the integer. The preview's HTML {expr} path lowers via
// interpolationToExpression, which wraps each interpolation in Number() so
// bool→1/0 while numbers pass through unchanged. This locks down that the
// preview stringifies booleans the same way snprintf("%d") does on hardware.

function makeSnapshot(initial: boolean): PreviewSnapshot {
  return {
    projectRoot: "", entryFile: "", htmlFile: "", uiTreeNames: ["screen"],
    program: {
      width: 32, height: 16, colorFormat: "rgb565",
      display: { rotation: 0 } as never,
      nodes: [
        {
          index: 0, tag: "screen", id: "home", classes: [],
          box: { x: 0, y: 0, w: 32, h: 16 }, bg: 0, fg: 0xffff,
          kind: "fill", textBuffer: "", parentIndex: 255,
          subtreeEnd: 2, screenId: 0, visible: true,
        } as never,
        {
          index: 1, tag: "text", id: "label", classes: [],
          box: { x: 0, y: 0, w: 32, h: 16 }, bg: 0, fg: 0xffff,
          kind: "text", text: "{on}", textBuffer: "", parentIndex: 0,
          subtreeEnd: 2, screenId: 0, visible: true,
        } as never,
      ],
      transitions: [],
    },
    font: new Array(1280).fill(0),
    // Mirrors what interpolationToExpression now produces for `{on}`:
    // `${Number(on)}` so booleans coerce to 1/0 (matching hardware's %d) while
    // numbers pass through Number() unchanged.
    bindings: [{ nodeId: "label", nodeIndex: 1, property: "text", expression: "`${Number(on)}`" }],
    listBindings: [], callbacks: [], initialAssignments: [], intervals: [],
    pinControls: [], canvasBindings: [],
    moduleVars: [{ name: "on", initializer: `ui.signal(${initial})` }],
    diagnostics: [],
  } as unknown as PreviewSnapshot;
}

describe("preview: bool signal stringifies as 1/0 to match hardware %d", () => {
  it("renders true as '1'", () => {
    const rt = new PreviewUIRuntime(makeSnapshot(true), {
      onFrame: () => {}, onDiagnostics: () => {},
    });
    rt.start();
    try {
      const nodes = (rt as unknown as { nodes: Array<{ textBuffer: string }> }).nodes;
      expect(nodes[1].textBuffer).toBe("1");
    } finally {
      rt.stop();
    }
  });

  it("renders false as '0'", () => {
    const rt = new PreviewUIRuntime(makeSnapshot(false), {
      onFrame: () => {}, onDiagnostics: () => {},
    });
    rt.start();
    try {
      const nodes = (rt as unknown as { nodes: Array<{ textBuffer: string }> }).nodes;
      expect(nodes[1].textBuffer).toBe("0");
    } finally {
      rt.stop();
    }
  });
});
