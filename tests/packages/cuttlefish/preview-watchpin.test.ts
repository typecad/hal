import { describe, it, expect } from "vitest";
import { PreviewUIRuntime } from "@typecad/cuttlefish/preview/host-ui-runtime";
import type { PreviewSnapshot } from "@typecad/cuttlefish/preview/types";

// ui.watchPin(pin, cb) registers a pin-watcher whose callback fires on a HIGH→LOW
// (falling) edge, polled every ~20ms in the device's microtask pump — no ISRs,
// natural debounce from the poll interval (see packages/ui/src/index.ts). On
// hardware the watcher runs autonomously; the preview used to fire it ONLY via a
// manual DOM button click in client.ts, with no edge semantics (every click =
// one fire). That diverges whenever the app relies on autonomous polling or on
// the falling-edge contract.
//
// This locks down the fix: the preview registers a ~20ms poller for each
// `watch` pinControl, fires the callback only on a HIGH→LOW transition, and
// exposes a synchronous setPinLevel() test hook so edge behavior is drivable
// without wall-clock waits.

function makeSnapshot(): PreviewSnapshot {
  return {
    projectRoot: "",
    entryFile: "",
    htmlFile: "",
    uiTreeNames: ["screen"],
    program: {
      width: 32, height: 16, colorFormat: "rgb565",
      display: { rotation: 0 } as never,
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
    bindings: [], listBindings: [], callbacks: [], initialAssignments: [],
    intervals: [],
    pinControls: [{
      label: "ui.watchPin(4)",
      kind: "watch",
      pin: "4",
      body: "taps.set(taps() + 1)",
    }],
    canvasBindings: [],
    moduleVars: [{ name: "taps", initializer: "ui.signal(0)" }],
    diagnostics: [],
  } as unknown as PreviewSnapshot;
}

describe("preview: ui.watchPin fires on falling edges via autonomous polling", () => {
  it("does not fire while the pin stays HIGH", () => {
    const diagnostics: string[] = [];
    const rt = new PreviewUIRuntime(makeSnapshot(), {
      onFrame: () => {}, onDiagnostics: (msg) => diagnostics.push(msg),
    });
    rt.start();
    try {
      // Pin starts HIGH; the watcher must not fire on the initial level.
      const scope = (rt as unknown as { moduleScope: Record<string, unknown> }).moduleScope;
      expect(scope.taps).toBe(0);
    } finally {
      rt.stop();
    }
    expect(diagnostics).toEqual([]);
  });

  it("fires exactly once on a HIGH→LOW edge, not on LOW→HIGH", () => {
    const rt = new PreviewUIRuntime(makeSnapshot(), {
      onFrame: () => {}, onDiagnostics: () => {},
    });
    rt.start();
    try {
      const rt2 = rt as unknown as {
        setPinLevel(pin: string, level: 0 | 1): void;
        moduleScope: Record<string, unknown>;
      };
      // Falling edge HIGH→LOW: one fire.
      rt2.setPinLevel("4", 0);
      expect(rt2.moduleScope.taps).toBe(1);
      // Rising edge LOW→HIGH: no fire.
      rt2.setPinLevel("4", 1);
      expect(rt2.moduleScope.taps).toBe(1);
      // Another falling edge: second fire.
      rt2.setPinLevel("4", 0);
      expect(rt2.moduleScope.taps).toBe(2);
      // Same level (no edge): no fire.
      rt2.setPinLevel("4", 0);
      expect(rt2.moduleScope.taps).toBe(2);
    } finally {
      rt.stop();
    }
  });
});
