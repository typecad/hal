// Preview runtime side of `await ui.onTap()`: the host runtime bumps a tap
// counter on every completed tap (mirroring the C++ __ui_tap_seq), so an
// `onTap()` Promise can resolve by polling it. See
// docs/superpowers/specs/2026-06-27-ui-ontap-awaitable-design.md

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PreviewUIRuntime } from "@typecad/cuttlefish/preview/host-ui-runtime";

function loadFont(): Uint8Array {
  const source = fs.readFileSync(
    path.resolve("demo-ui/lib/Adafruit_GFX_Library/glcdfont.c"),
    "utf-8",
  );
  const match = /font\[\]\s+PROGMEM\s*=\s*\{([\s\S]*?)\};/.exec(source);
  const bytes = [...(match?.[1] ?? source).matchAll(/0x([0-9a-fA-F]{1,2})/g)].map(
    (m) => parseInt(m[1], 16),
  );
  return new Uint8Array(bytes.slice(0, 1280));
}

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
    parentIndex: 255,
    subtreeEnd: 1,
    screenId: 0,
    visible: true,
    ...overrides,
  };
}

function makeRuntime(
  nodes: ReturnType<typeof makeNode>[],
  callbacks: Array<{ nodeId: string; nodeIndex: number; kind: "click"; body: string }> = [],
) {
  return new PreviewUIRuntime({
    projectRoot: "",
    entryFile: "",
    htmlFile: "",
    uiTreeNames: ["screen"],
    program: {
      width: 40,
      height: 30,
      colorFormat: "rgb565",
      nodes,
      transitions: [],
    },
    font: Array.from(loadFont()),
    bindings: [],
    listBindings: [],
    callbacks,
    initialAssignments: [],
    intervals: [],
    pinControls: [],
    diagnostics: [],
  } as any);
}

describe("ui.onTap preview tap source", () => {
  it("bumps tapSeq on a tap that hits an element, recording the node", () => {
    const runtime = makeRuntime(
      [
        makeNode({ index: 0, tag: "screen", hasBg: true, subtreeEnd: 2, box: { x: 0, y: 0, w: 40, h: 30 } }),
        makeNode({ index: 1, id: "btn", tag: "button", kind: "button", box: { x: 5, y: 5, w: 10, h: 8 }, parentIndex: 0, subtreeEnd: 2 }),
      ],
      // A button needs a registered handler to be a hit-test target (matches
      // the device ui_hit_test, which skips nodes without click handlers).
      [{ nodeId: "btn", nodeIndex: 1, kind: "click", body: "" }],
    );
    runtime.start();
    try {
      expect(runtime.tapSeq).toBe(0);
      runtime.pointerDown(8, 8);   // inside btn
      runtime.pointerUp();
      expect(runtime.tapSeq).toBe(1);
      expect(runtime.tapNode).toBe(1);
    } finally {
      runtime.stop();
    }
  });

  it("bumps tapSeq on an empty-space tap with tapNode === -1 (wake-on-any-touch)", () => {
    const runtime = makeRuntime([
      makeNode({ index: 0, tag: "screen", hasBg: true, subtreeEnd: 1, box: { x: 0, y: 0, w: 40, h: 30 } }),
    ]);
    runtime.start();
    try {
      runtime.pointerDown(35, 25);   // empty space, no interactive node
      runtime.pointerUp();
      expect(runtime.tapSeq).toBe(1);
      expect(runtime.tapNode).toBe(-1);
    } finally {
      runtime.stop();
    }
  });
});
