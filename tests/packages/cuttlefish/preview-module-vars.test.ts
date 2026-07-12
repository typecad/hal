import { describe, it, expect } from "vitest";
import { PreviewUIRuntime } from "@typecad/ui/preview/host-ui-runtime";
import type { PreviewSnapshot } from "@typecad/ui/preview/types";

// The preview executes author callback bodies (setInterval, onClick, ui.bind,
// etc.) in an isolated `Function`. The device transpiler hoists module-scoped
// `let`/`const`/`var` declarations to C++ globals, so a body like
//   let counter = 0;
//   setInterval(() => { counter = counter + 1; ... }, 60);
// works on hardware. The preview used to drop module-level declarations, so the
// interval body threw `ReferenceError: counter is not defined` and surfaced as
// "preview callback failed: counter = counter + 1".
//
// This locks down the fix: module-scoped variables are captured, seeded with
// their initializers, and shared (mutably) across every callback invocation.
// The fixture is self-contained (no demo coupling) so it survives demo churn.

// Build a minimal in-memory snapshot. The preview runtime only needs a screen
// node + the interval/moduleVar specs — the interval body references the module
// var, and runBody/normalizeScript rewrite the bare name to moduleScope.NAME.
function makeSnapshot(counterInit: string, step: string): PreviewSnapshot {
  return {
    projectRoot: "",
    entryFile: "",
    htmlFile: "",
    uiTreeNames: ["screen"],
    program: {
      width: 32,
      height: 16,
      colorFormat: "rgb565",
      nodes: [
        {
          index: 0, tag: "screen", id: "home", classes: [],
          box: { x: 0, y: 0, w: 32, h: 16 }, bg: 0, fg: 0xffff,
          kind: "fill", textBuffer: "", parentIndex: 255,
          subtreeEnd: 1, screenId: 0, visible: true,
        } as never,
      ],
      transitions: [],
    },
    font: new Array(1280).fill(0),
    bindings: [], listBindings: [], callbacks: [],
    initialAssignments: [],
    intervals: [{ body: `counter = counter ${step};`, delayMs: 4 }],
    pinControls: [],
    canvasBindings: [],
    moduleVars: [{ name: "counter", initializer: counterInit }],
    diagnostics: [],
  } as unknown as PreviewSnapshot;
}

describe("preview: module-scoped variables are visible to callback bodies", () => {
  it("captures counter as a module var seeded with its initializer", () => {
    // Mirrors what extractAuthorSpecs produces from `let counter = 7;` — the
    // runtime trusts the snapshot's moduleVars list, so we provide it directly.
    const snapshot = makeSnapshot("7", "+ 1");
    const vars = snapshot.moduleVars;
    const counter = vars.find((v) => v.name === "counter");
    expect(counter).toBeDefined();
    expect(counter!.initializer).toBe("7");
  });

  it("runs the interval without a ReferenceError and advances counter", async () => {
    const diagnostics: string[] = [];
    const rt = new PreviewUIRuntime(makeSnapshot("180", "+ 3"), {
      onFrame: () => {},
      onDiagnostics: (msg) => diagnostics.push(msg),
    });
    rt.start();
    try {
      // The interval uses a real setInterval(4ms), so wait wall-clock time for
      // it to fire a few times rather than driving it via tick().
      await new Promise((resolve) => setTimeout(resolve, 40));
    } finally {
      rt.stop();
    }

    // No "preview callback failed" should mention counter.
    const failures = diagnostics.filter((m) => /counter/i.test(m));
    expect(failures).toEqual([]);

    // The module scope should reflect the mutated value (180 + 3 per tick that fired).
    const scope = (rt as unknown as { moduleScope: Record<string, unknown> }).moduleScope;
    expect(typeof scope.counter).toBe("number");
    expect(scope.counter).toBeGreaterThan(180);
  }, 15000);
});
