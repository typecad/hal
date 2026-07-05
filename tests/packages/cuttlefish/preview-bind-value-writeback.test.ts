import { describe, it, expect } from "vitest";
import { PreviewUIRuntime } from "@typecad/cuttlefish/preview/host-ui-runtime";
import type { PreviewSnapshot } from "@typecad/cuttlefish/preview/types";

// `bind:value` is a declarative two-way binding: signal → node value (read),
// and node → signal (write-back). On hardware (ui-element-auto-wire.ts:124-140),
// the write-back is recorded as a click handler for <check> (kind: "click") or a
// rangechange handler for <range> (kind: "rangechange"), with body
// `${sig}.set(__ui_nodes[idx].value)`.
//
// The preview used to synthesize the write-back with kind: "change" for both
// (build-program.ts collectBindBindings), but "change" is only dispatched on
// keyboard commit — so dragging a range or toggling a check never reached the
// signal. This locks down the fix: range drags fire "rangechange", check taps
// fire "click", and the signal's value tracks the control in both directions.

interface Options { tag: "range" | "check"; bindValue: string; }

function makeSnapshot(opts: Options): PreviewSnapshot {
  // A 64x16 single screen with one control bound to a signal via bind:value.
  const isRange = opts.tag === "range";
  const nodeKind = isRange ? "range" : "check";
  return {
    projectRoot: "",
    entryFile: "",
    htmlFile: "",
    uiTreeNames: ["screen"],
    program: {
      width: 64, height: 16, colorFormat: "rgb565",
      display: { rotation: 0 } as never,
      nodes: [
        {
          index: 0, tag: "screen", id: "home", classes: [],
          box: { x: 0, y: 0, w: 64, h: 16 }, bg: 0, fg: 0xffff,
          kind: "fill", textBuffer: "", parentIndex: 255,
          subtreeEnd: 2, screenId: 0, visible: true,
        } as never,
        {
          index: 1, tag: opts.tag, id: "ctl", classes: [],
          // Place the control so a tap at (10, 4) lands inside it.
          box: { x: 0, y: 0, w: 64, h: 16 }, bg: 0, fg: 0xffff,
          kind: nodeKind, textBuffer: "", parentIndex: 0,
          subtreeEnd: 2, screenId: 0, visible: true,
          // Range bounds 0..10 so a drag to x≈32 yields ~5.
          rangeMin: 0, rangeMax: 10,
        } as never,
      ],
      transitions: [],
    },
    font: new Array(1280).fill(0),
    // Read-half: signal → node value (evaluates each tick).
    bindings: [{ nodeId: "ctl", nodeIndex: 1, property: "value", expression: opts.bindValue }],
    listBindings: [], callbacks: [],
    initialAssignments: [],
    intervals: [],
    pinControls: [],
    canvasBindings: [],
    // Write-half: node → signal. Mirrors collectBindBindings; the event KIND is
    // what's under test (range → rangechange, check → click).
    callbacks: isRange
      ? [{ nodeId: "ctl", nodeIndex: 1, kind: "rangechange", body: `${opts.bindValue}.set(screen.ctl.value)` }]
      : [{ nodeId: "ctl", nodeIndex: 1, kind: "click", body: `${opts.bindValue}.set(screen.ctl.value)` }],
    moduleVars: [{ name: opts.bindValue, initializer: "ui.signal(0)" }],
    diagnostics: [],
  } as unknown as PreviewSnapshot;
}

describe("preview: bind:value write-back fires on the right event kind", () => {
  it("range drag updates the signal via rangechange", () => {
    const diagnostics: string[] = [];
    const rt = new PreviewUIRuntime(makeSnapshot({ tag: "range", bindValue: "v" }), {
      onFrame: () => {},
      onDiagnostics: (msg) => diagnostics.push(msg),
    });
    rt.start();
    try {
      // Press near the left edge, drag to the middle, release.
      rt.pointerDown(2, 4);
      rt.pointerMove(32, 4);
      rt.pointerUp();
      const scope = (rt as unknown as { moduleScope: Record<string, unknown> }).moduleScope;
      const nodes = (rt as unknown as { nodes: Array<{ value: number }> }).nodes;
      // The drag should have advanced both node.value and the bound signal.
      expect(nodes[1].value).toBeGreaterThan(0);
      expect(scope.v).toBe(nodes[1].value);
    } finally {
      rt.stop();
    }
    expect(diagnostics).toEqual([]);
  });

  it("check tap toggles the signal via click", async () => {
    const diagnostics: string[] = [];
    const rt = new PreviewUIRuntime(makeSnapshot({ tag: "check", bindValue: "on" }), {
      onFrame: () => {},
      onDiagnostics: (msg) => diagnostics.push(msg),
    });
    rt.start();
    try {
      // Tap the check (down + up = a click).
      rt.pointerDown(10, 4);
      rt.pointerUp();
      let scope = (rt as unknown as { moduleScope: Record<string, unknown> }).moduleScope;
      const nodes = (rt as unknown as { nodes: Array<{ value: number }> }).nodes;
      expect(nodes[1].value).toBe(1);
      expect(scope.on).toBe(1);
      // Wait out the touch debounce (UI_TOUCH_DEBOUNCE_MS = 50ms) before the
      // second tap, otherwise pointerDown is suppressed as a double-tap.
      await new Promise((resolve) => setTimeout(resolve, 60));
      // Tap again → toggles back to 0, signal follows.
      rt.pointerDown(10, 4);
      rt.pointerUp();
      scope = (rt as unknown as { moduleScope: Record<string, unknown> }).moduleScope;
      expect(nodes[1].value).toBe(0);
      expect(scope.on).toBe(0);
    } finally {
      rt.stop();
    }
    expect(diagnostics).toEqual([]);
  }, 15000);
});
