import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfigFile } from "../../../packages/cuttlefish/src/config-loader";
import { buildPreviewSnapshot } from "../../../packages/cuttlefish/src/preview/build-program";

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
    expect(snapshot.program.nodes.some((node) => node.id === "btn" && node.kind === "button")).toBe(true);
    expect(snapshot.program.nodes.find((node) => node.id === "ssid")).toMatchObject({
      kind: "input",
      inputType: "text",
      placeholder: "Network",
      maxlen: 32,
    });
    const speedSlow = snapshot.program.nodes.find((node) => node.id === "speedSlow");
    const speedFast = snapshot.program.nodes.find((node) => node.id === "speedFast");
    expect(speedSlow).toMatchObject({ kind: "radio", name: "speed", valueAttr: "slow", value: 0 });
    expect(speedFast).toMatchObject({ kind: "radio", name: "speed", valueAttr: "fast", checked: true, value: 1 });
    expect(snapshot.bindings.some((binding) => binding.nodeId === "counter" && binding.property === "text")).toBe(true);
    expect(snapshot.callbacks.some((callback) => callback.nodeId === "btn" && callback.kind === "click")).toBe(true);
    expect(snapshot.callbacks.some((callback) => callback.nodeId === "ssid" && callback.kind === "change")).toBe(true);
    expect(snapshot.cssRules.some((rule) => rule.selector.compounds.length === 1 && rule.selector.compounds[0].some(s => s.kind === "class" && s.name === "ui-key"))).toBe(true);
    expect(snapshot.program.keyframeSets.some((set) => set.name === "pulse")).toBe(true);
    expect(snapshot.program.animations.some((animation) => snapshot.program.nodes[animation.node]?.id === "pulseIndicator")).toBe(true);
    const aboutBody = snapshot.program.nodes.find((node) => node.id === "aboutBody");
    expect(aboutBody).toMatchObject({ scrollable: true, box: { y: 70, h: 160 } });
    expect(aboutBody!.box.y + aboutBody!.box.h).toBeLessThanOrEqual(snapshot.program.height);
    expect(aboutBody!.contentHeight).toBeGreaterThan(aboutBody!.box.h);
    const fitContain = snapshot.program.nodes.find((node) => node.id === "fitImgContain");
    const fitCover = snapshot.program.nodes.find((node) => node.id === "fitImgCover");
    const fitFill = snapshot.program.nodes.find((node) => node.id === "fitImgFill");
    expect(fitContain).toMatchObject({ kind: "img", box: { w: 60, h: 40 }, objectFit: 2 });
    expect(fitCover).toMatchObject({ kind: "img", box: { w: 60, h: 40 }, objectFit: 3 });
    expect(fitFill).toMatchObject({ kind: "img", box: { w: 60, h: 40 }, objectFit: 1 });
    expect(fitContain?.imgDataId).not.toBe(255);
    expect(fitCover?.imgDataId).toBe(fitContain?.imgDataId);
    expect(fitFill?.imgDataId).toBe(fitContain?.imgDataId);
    expect(snapshot.program.imageAssets[fitContain!.imgDataId]).toMatchObject({ width: 48, height: 24 });
    expect(snapshot.intervals).toHaveLength(1);
    expect(snapshot.font).toHaveLength(1280);
  });
});
