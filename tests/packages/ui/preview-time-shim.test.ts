// Scripts import { Time } from '@typecad/hal' and call Time.now() inside
// ui.bind callbacks. The device lowers that to the uptime clock; the preview
// evaluates the authored expression verbatim, so the sandbox must provide a
// Time shim backed by the runtime's simulated clock — without it every
// timing binding throws "Time is not defined" once per tick (surfacing as a
// spammed diagnostics panel and a frozen preview).
import { describe, it, expect, afterEach } from "vitest";
import { parseCss } from "@typecad/ui/ui-engine/css-parser";
import { parseHtmlWithKeyboards } from "@typecad/ui/ui-engine/html-parser";
import { resolveStyles } from "@typecad/ui/ui-engine/style-resolver";
import { BlockLayoutEngine } from "@typecad/ui/ui-engine/block-layout";
import { measure } from "@typecad/ui/ui-engine/layout-engine";
import { lowerUIToModel } from "@typecad/ui/ui-engine/model";
import { PreviewUIRuntime } from "@typecad/ui/preview/host-ui-runtime";
import type { PreviewSnapshot } from "@typecad/ui/preview/types";
import { setDisplayProfile, resetDisplayProfile } from "@typecad/cuttlefish/stores/display-profile-store";

function snapshotWithTimeBinding() {
  const html = `<screen><text id="clock">t=0ms</text></screen>`;
  const css = `#clock { font-size: 12px; color: #ffffff; }`;
  const rules = parseCss(css);
  const [screen] = parseHtmlWithKeyboards(html).screens.map((s: never) => resolveStyles(s, rules));
  const boxes = new BlockLayoutEngine().arrange(screen, { x: 0, y: 0, w: 128, h: 64 }, measure);
  const program = lowerUIToModel(screen as never, boxes, "mono", undefined, [], [], new Map(), []);
  const clockIndex = program.nodes.findIndex((n) => (n as { id?: string }).id === "clock");
  return {
    projectRoot: ".",
    entryFile: "app.ui",
    htmlFile: "app.ui.html",
    program,
    keyboardTemplates: [],
    cssRules: rules,
    uiTreeNames: [],
    font: [],
    bindings: [
      {
        nodeIndex: clockIndex,
        property: "text",
        expression: "`t=${Time.now()}ms`",
      },
    ],
    listBindings: [],
    callbacks: [],
    initialAssignments: [],
    intervals: [],
    pinControls: [],
    canvasBindings: [],
    moduleVars: [],
    diagnostics: [],
  } as unknown as PreviewSnapshot;
}

describe("preview Time shim", () => {
  afterEach(() => resetDisplayProfile());

  it("evaluates Time.now() bindings against the simulated clock without diagnostics", () => {
    setDisplayProfile(
      { driver: "solomon,ssd1306", width: 128, height: 64, colorFormat: "mono", rotation: 0 } as never,
      {},
    );
    const diagnostics: string[] = [];
    const runtime = new PreviewUIRuntime(snapshotWithTimeBinding(), {
      onDiagnostics: (message) => diagnostics.push(message),
    });
    runtime.start();
    expect(diagnostics, "no 'Time is not defined' spam").toEqual([]);
    const nodes = (runtime as unknown as { nodes: { textBuffer?: string }[] }).nodes;
    const text = nodes.map((n) => n.textBuffer ?? "").find((t) => /^t=\d+ms$/.test(t));
    expect(text, "bound text rendered").toBeDefined();
    runtime.tick(1500);
    const ms = Number(/t=(\d+)ms/.exec(nodes.map((n) => n.textBuffer ?? "").find((t) => /^t=\d+ms$/.test(t)) ?? "")?.[1] ?? -1);
    expect(ms).toBeGreaterThanOrEqual(1516);
    expect(diagnostics).toEqual([]);
  });
});
