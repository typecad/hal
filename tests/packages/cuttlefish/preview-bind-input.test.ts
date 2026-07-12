import { describe, it, expect } from "vitest";
import { PreviewUIRuntime } from "@typecad/ui/preview/host-ui-runtime";
import type { PreviewSnapshot } from "@typecad/ui/preview/types";

// ui.bindInput(node, cb) subscribes to an <input>'s committed text. On hardware
// (ui-call-resolver.ts resolveBindInputCall) the callback fires whenever the
// bound node's textBuffer changes (keyboard commit), with the new text passed
// as the cb's first argument (renamed to `text` in the lowered C++).
//
// The preview used to drop bindInput entirely — extractAuthorSpecs had no
// method === "bindInput" branch, so the callback never ran in the browser even
// though it fired on hardware. This locks down the fix: bindInput is collected
// as a "change" callback (firing on keyboard close), and the committed text is
// bound to the callback's parameter so the body sees the same value the device
// passes.

function makeSnapshot(): PreviewSnapshot {
  return {
    projectRoot: "",
    entryFile: "",
    htmlFile: "",
    uiTreeNames: ["screen"],
    program: {
      width: 64, height: 32, colorFormat: "rgb565",
      display: { rotation: 0 } as never,
      nodes: [
        {
          index: 0, tag: "screen", id: "home", classes: [],
          box: { x: 0, y: 0, w: 64, h: 32 }, bg: 0, fg: 0xffff,
          kind: "fill", textBuffer: "", parentIndex: 255,
          subtreeEnd: 2, screenId: 0, visible: true,
        } as never,
        {
          index: 1, tag: "input", id: "name", classes: [],
          box: { x: 0, y: 0, w: 64, h: 16 }, bg: 0, fg: 0xffff,
          kind: "input", textBuffer: "", placeholder: "name",
          parentIndex: 0, subtreeEnd: 2, screenId: 0, visible: true,
          maxlen: 20,
        } as never,
      ],
      transitions: [],
    },
    font: new Array(1280).fill(0),
    bindings: [],
    listBindings: [],
    // The bindInput callback: (text) => { captured.set(text); }. Mirrors what
    // build-program.ts would synthesize — kind "change" fires on keyboard close,
    // and param "text" receives the committed string.
    callbacks: [{
      nodeId: "name", nodeIndex: 1, kind: "change",
      body: "captured.set(text)",
      param: "text",
    } as never],
    initialAssignments: [],
    intervals: [],
    pinControls: [],
    canvasBindings: [],
    moduleVars: [
      { name: "captured", initializer: "ui.signal(\"\")" },
    ],
    diagnostics: [],
  } as unknown as PreviewSnapshot;
}

describe("preview: ui.bindInput callback fires on keyboard commit with the text", () => {
  it("runs the callback body with the committed text bound to its param", () => {
    const diagnostics: string[] = [];
    const rt = new PreviewUIRuntime(makeSnapshot(), {
      onFrame: () => {},
      onDiagnostics: (msg) => diagnostics.push(msg),
    });
    rt.start();
    try {
      // Open the on-screen keyboard on the input, type, and close — this is the
      // gesture that on hardware fires the bindInput callback. Drive it directly
      // through the keyboard path: open, fill the buffer, close.
      const rt2 = rt as unknown as {
        keyboardOpen(nodeIndex: number): void;
        keyboardBuffer: string;
        keyboardClose(): void;
        moduleScope: Record<string, unknown>;
      };
      rt2.keyboardOpen(1);
      rt2.keyboardBuffer = "ada";
      rt2.keyboardClose();

      // The callback wrote the committed text into the signal via .set(text),
      // which the signal rewrite lowers to `captured = text`. The signal value
      // (not the getter) must now be the typed string.
      expect(rt2.moduleScope.captured).toBe("ada");
    } finally {
      rt.stop();
    }
    expect(diagnostics).toEqual([]);
  });
});
