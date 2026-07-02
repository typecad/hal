import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfigFile } from "../../../packages/cuttlefish/src/config-loader";
import { buildPreviewSnapshot } from "../../../packages/cuttlefish/src/preview/build-program";
import { resolveColor } from "../../../packages/cuttlefish/src/ui/color";

describe("preview snapshot builder", () => {
  it("resolves demo-ui ili9341-spi profile and extracts interactive specs", async () => {
    const configPath = path.resolve("demo-ui/cuttlefish.config.ts");
    const config = parseConfigFile(configPath);
    expect(config).toBeDefined();

    const snapshot = await buildPreviewSnapshot({
      config: config!,
      projectRoot: path.dirname(configPath),
    });

    expect(snapshot.profileName).toBe("ili9341-spi");
    expect(snapshot.program.width).toBe(320);
    expect(snapshot.program.height).toBe(240);
    expect(snapshot.program.colorFormat).toBe("rgb565");
    expect(snapshot.program.display?.rotation).toBe(1);

    const button = snapshot.program.nodes.find((node) => node.id === "formBtn" && node.kind === "button");
    expect(button).toBeDefined();
    expect(button!.bg).toBe(resolveColor("#ff6666", snapshot.program.colorFormat));
    expect(snapshot.program.nodes.find((node) => node.id === "formName")).toMatchObject({
      kind: "input",
      inputType: "text",
      placeholder: "enter name",
      maxlen: 20,
    });
    expect(snapshot.program.nodes.find((node) => node.id === "formAge")).toMatchObject({
      kind: "input",
      inputType: "number",
      placeholder: "0",
      maxlen: 3,
    });
    const formRadio1 = snapshot.program.nodes.find((node) => node.id === "formRadio1");
    const formRadio2 = snapshot.program.nodes.find((node) => node.id === "formRadio2");
    expect(formRadio1).toMatchObject({ kind: "radio", name: "grp", valueAttr: "x", value: 1 });
    expect(formRadio2).toMatchObject({ kind: "radio", name: "grp", valueAttr: "y", value: 0 });
    expect(snapshot.bindings.some((binding) => binding.nodeId === "formBtnCount" && binding.property === "text")).toBe(true);
    expect(snapshot.listBindings).toContainEqual(expect.objectContaining({
      nodeId: "demoList",
      countExpression: "40",
      itemExpression: "`Item ${i + 1}`",
      itemParam: "i",
      tapParam: "i",
    }));
    expect(snapshot.callbacks.some((callback) => callback.nodeId === "formBtn" && callback.kind === "click")).toBe(true);
    expect(snapshot.callbacks.some((callback) => callback.nodeId === "formName" && callback.kind === "change")).toBe(true);
    expect(snapshot.callbacks.some((callback) => callback.nodeId === "formAge" && callback.kind === "change")).toBe(true);
    expect(snapshot.callbacks.some((callback) => callback.nodeId === "kbInput" && callback.kind === "change")).toBe(true);
    expect(snapshot.cssRules.some((rule) => rule.selector.compounds.length === 1 && rule.selector.compounds[0].some(s => s.kind === "class" && s.name === "ui-key"))).toBe(true);
    expect(snapshot.program.keyframeSets.some((set) => set.name === "pulse")).toBe(true);
    expect(snapshot.program.animations.some((animation) => snapshot.program.nodes[animation.node]?.id === "dotPulse")).toBe(true);

    const richScreen = snapshot.program.nodes.find((node) => node.id === "richtext");
    expect(richScreen).toBeDefined();
    const richMixed = snapshot.program.nodes.find((node) =>
      node.screenId === richScreen!.screenId && node.runs?.some((run) => run.text.includes("rich text"))
    );
    expect(richMixed).toBeDefined();
    expect(richMixed!.runLines!.lineH).toContain(24);
    const richBreak = snapshot.program.nodes.find((node) =>
      node.screenId === richScreen!.screenId && node.runs?.some((run) => run.text.includes("After a blank line."))
    );
    expect(richBreak).toBeDefined();
    expect(richBreak!.runLines!.lineW).toContain(0);
    expect(richBreak!.runLines!.lineH[richBreak!.runLines!.lineW.indexOf(0)]).toBe(16);

    const aboutBody = snapshot.program.nodes.find((node) => node.screenId === richScreen!.screenId && node.scrollable);
    expect(aboutBody).toMatchObject({ scrollable: true });
    // The body sits below the screen header and fills the remaining viewport.
    expect(aboutBody!.box.y).toBeGreaterThan(0);
    expect(aboutBody!.box.y + aboutBody!.box.h).toBeLessThanOrEqual(snapshot.program.height);
    expect(aboutBody!.contentHeight).toBeGreaterThan(aboutBody!.box.h);
    const fitContain = snapshot.program.nodes.find((node) => node.id === "imgContain");
    const fitCover = snapshot.program.nodes.find((node) => node.id === "imgCover");
    const fitFill = snapshot.program.nodes.find((node) => node.id === "imgFill");
    expect(fitContain).toMatchObject({ kind: "img", box: { w: 60, h: 40 }, objectFit: 2 });
    expect(fitCover).toMatchObject({ kind: "img", box: { w: 60, h: 40 }, objectFit: 3 });
    expect(fitFill).toMatchObject({ kind: "img", box: { w: 60, h: 40 }, objectFit: 1 });
    expect(fitContain?.imgDataId).not.toBe(255);
    expect(fitCover?.imgDataId).toBe(fitContain?.imgDataId);
    expect(fitFill?.imgDataId).toBe(fitContain?.imgDataId);
    expect(snapshot.program.imageAssets[fitContain!.imgDataId]).toMatchObject({ width: 48, height: 24 });
    // One interval: the progress-bar animator.
    expect(snapshot.intervals).toHaveLength(1);
    expect(snapshot.font).toHaveLength(1280);
    const canvas = snapshot.program.nodes.find((node) => node.id === "demoCanvas" && node.kind === "canvas");
    expect(canvas).toMatchObject({ kind: "canvas", canvasW: 200, canvasH: 120 });
    expect(snapshot.canvasBindings.some((b) => b.nodeId === "demoCanvas")).toBe(true);
  });
});
