import { describe, it, expect } from "vitest";
import { resolveStyles } from "@typecad/cuttlefish/ui/style-resolver";
import { parseHtml, parseAllScreens } from "@typecad/cuttlefish/ui/html-parser";
import { parseCss } from "@typecad/cuttlefish/ui/css-parser";
import { lowerUIToModel } from "@typecad/cuttlefish/ui/model";
import { selectEngine } from "../../../packages/cuttlefish/src/ui/select-engine";
import { measure } from "@typecad/cuttlefish/ui/layout-engine";

function lowerOne(html: string, css = "") {
  const styled = resolveStyles(parseHtml(html), parseCss(css));
  const boxes = selectEngine(styled).arrange(styled, { x: 0, y: 0, w: 320, h: 240 }, measure);
  return lowerUIToModel(styled, boxes, "rgb565");
}

describe("run lowering", () => {
  it("a run-bearing node lowers to runs[] and runLines", () => {
    const program = lowerOne(`<screen><p id="p">Hello <b>world</b></p></screen>`);
    const p = program.nodes.find(n => n.id === "p")!;
    expect(p.runs).toBeDefined();
    expect(p.runs!.length).toBe(2);
    expect(p.runs!.find(r => r.text === "world")).toBeDefined();
    // Bold no longer inflates the GFX text-size bucket (matches web behavior —
    // bold affects stroke weight via @font-face, not rendered size). Both runs
    // are 16px, so both lower to the same textSize.
    const hello = p.runs!.find(r => r.text === "Hello ")!;
    const world = p.runs!.find(r => r.text === "world")!;
    expect(world.textSize).toBe(hello.textSize);
    expect(p.runLines).toBeDefined();
    expect(p.runLines!.segRun.length).toBeGreaterThan(0);
    expect(p.runLines!.segText.length).toBe(p.runLines!.segRun.length);
  });

  it("a plain text node has no runs/runLines (regression guard)", () => {
    const program = lowerOne(`<screen><text id="t">hi</text></screen>`);
    const t = program.nodes.find(n => n.id === "t")!;
    expect(t.runs).toBeUndefined();
    expect(t.runLines).toBeUndefined();
    expect(t.text).toBe("hi");
  });

  it("link run gets linkTarget = resolved screen index; non-link run = -1", () => {
    const html = `<screen id="home"><p id="p">go <a href="#other">there</a></p></screen><screen id="other"></screen>`;
    const screens = parseAllScreens(html).map(s => resolveStyles(s, []));
    const styled = screens[0];
    const boxes = selectEngine(styled).arrange(styled, { x: 0, y: 0, w: 320, h: 240 }, measure);
    const program = lowerUIToModel(styled, boxes, "rgb565", undefined, [], screens);
    const p = program.nodes.find(n => n.id === "p")!;
    const runs = p.runs!;
    const there = runs.find(r => r.text === "there")!;
    const go = runs.find(r => r.text === "go ")!;
    expect(there.linkTarget).toBeGreaterThanOrEqual(0);  // resolved to a screen
    expect(go.linkTarget).toBe(-1);                       // plain text run
  });

  it("runLines geometry: a single run that wraps produces segments across lines", () => {
    // A <span> with long text inside a narrow <p> forces the run to wrap; the
    // same run then produces segments on multiple lines.
    const program = lowerOne(`<screen><p id="p" style="width:60px"><span>aaaa bbbb</span></p></screen>`);
    const p = program.nodes.find(n => n.id === "p")!;
    expect(p.runs).toBeDefined();
    expect(p.runLines).toBeDefined();
    // All segments belong to runIndex 0 (the single span run).
    expect(p.runLines!.segRun.every(ri => ri === 0)).toBe(true);
  });

  it("a <br> produces a line break in runLines", () => {
    const program = lowerOne(`<screen><p id="p">a<br>b</p></screen>`);
    const p = program.nodes.find(n => n.id === "p")!;
    expect(p.runs).toBeDefined();
    // The hard-break run is present.
    expect(p.runs!.some(r => r.text === "\n")).toBe(true);
    // Two lines from the break.
    expect(new Set(p.runLines!.segLine).size).toBe(2);
  });
});
