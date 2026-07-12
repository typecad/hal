import { describe, it, expect } from "vitest";
import { PreviewUIRuntime } from "@typecad/ui/preview/host-ui-runtime";
import type { PreviewSnapshot } from "@typecad/ui/preview/types";

// On the device, `const count = ui.signal(0)` lowers to a plain `int count = 0;`
// file-scope variable (the getter is a compile-time fiction). References to the
// signal in templates and callbacks are rewritten: `count()` → `count` (read),
// `count.set(x)` → `count = x` (write), and `{count}` interpolations snprintf
// the variable directly. See ir/transformers/variables.ts and
// ir/transformers/ui-callback-lowering.ts.
//
// The preview used to seed `moduleScope.count` with the live getter function
// returned by the `ui` facade, so a template `${count}` stringified the getter
// source ("() => v") instead of the value. This showed up in the demo's button /
// text / number cards, which display `{count}`, `{nameCommits}`, `{ageCommits}`
// next to their inputs. Writes via `.set()` also never reached the binding
// because the closure's value wasn't the same slot the binding read.
//
// This locks down the fix: signals lower to plain mutable values in moduleScope,
// `signal.set(x)` rewrites to `signal = x`, and `signal()` rewrites to `signal`,
// so the preview matches the runtime lowering exactly. The fixture is
// self-contained (no demo coupling) so it survives demo churn.

function makeSnapshot(): PreviewSnapshot {
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
          subtreeEnd: 2, screenId: 0, visible: true,
        } as never,
        {
          index: 1, tag: "text", id: "counter", classes: [],
          box: { x: 0, y: 0, w: 32, h: 16 }, bg: 0, fg: 0xffff,
          kind: "text", text: "{count}", textBuffer: "", parentIndex: 0,
          subtreeEnd: 2, screenId: 0, visible: true,
        } as never,
      ],
      transitions: [],
    },
    font: new Array(1280).fill(0),
    // Mirrors collectInterpolationBindings: `{count}` → text binding whose
    // expression is a JS template literal the preview evaluates each tick.
    bindings: [{ nodeId: "counter", nodeIndex: 1, property: "text", expression: "`${count}`" }],
    listBindings: [], callbacks: [],
    initialAssignments: [],
    intervals: [{ body: "count.set(count() + 1);", delayMs: 4 }],
    pinControls: [],
    canvasBindings: [],
    moduleVars: [{ name: "count", initializer: "ui.signal(0)" }],
    diagnostics: [],
  } as unknown as PreviewSnapshot;
}

describe("preview: ui.signal() lowers to a plain value, not a getter", () => {
  it("seeds moduleScope.count with the initial value (0), not a function", () => {
    const diagnostics: string[] = [];
    const rt = new PreviewUIRuntime(makeSnapshot(), {
      onFrame: () => {},
      onDiagnostics: (msg) => diagnostics.push(msg),
    });
    rt.start();
    try {
      const scope = (rt as unknown as { moduleScope: Record<string, unknown> }).moduleScope;
      expect(typeof scope.count).toBe("number");
      expect(scope.count).toBe(0);
    } finally {
      rt.stop();
    }
    expect(diagnostics).toEqual([]);
  });

  it("renders the {count} interpolation as the value ('0'), not the getter source", () => {
    const diagnostics: string[] = [];
    const rt = new PreviewUIRuntime(makeSnapshot(), {
      onFrame: () => {},
      onDiagnostics: (msg) => diagnostics.push(msg),
    });
    rt.start();
    try {
      const nodes = (rt as unknown as { nodes: Array<{ textBuffer: string }> }).nodes;
      // Before the fix this was "() => v" — the stringified getter.
      expect(nodes[1].textBuffer).toBe("0");
    } finally {
      rt.stop();
    }
    expect(diagnostics).toEqual([]);
  });

  it("advances count via count.set(count() + 1) and the bound text follows", async () => {
    const diagnostics: string[] = [];
    const rt = new PreviewUIRuntime(makeSnapshot(), {
      onFrame: () => {},
      onDiagnostics: (msg) => diagnostics.push(msg),
    });
    rt.start();
    try {
      // The interval uses a real setInterval(4ms); let it fire a few times.
      await new Promise((resolve) => setTimeout(resolve, 40));
      // Drive a final binding re-evaluation so textBuffer reflects the latest
      // moduleScope value even if the interval fired just after the last tick.
      rt.tick();
    } finally {
      rt.stop();
    }

    const scope = (rt as unknown as { moduleScope: Record<string, unknown> }).moduleScope;
    const nodes = (rt as unknown as { nodes: Array<{ textBuffer: string }> }).nodes;
    expect(typeof scope.count).toBe("number");
    expect(scope.count).toBeGreaterThan(0);
    // textBuffer must be the stringified current value, never the getter source.
    expect(nodes[1].textBuffer).toBe(String(scope.count));
    expect(nodes[1].textBuffer).not.toContain("=>");
    expect(diagnostics).toEqual([]);
  }, 15000);
});
