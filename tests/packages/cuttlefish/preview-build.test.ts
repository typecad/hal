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
    const speedSlow = snapshot.program.nodes.find((node) => node.id === "speedSlow");
    const speedFast = snapshot.program.nodes.find((node) => node.id === "speedFast");
    expect(speedSlow).toMatchObject({ kind: "radio", name: "speed", valueAttr: "slow", value: 0 });
    expect(speedFast).toMatchObject({ kind: "radio", name: "speed", valueAttr: "fast", checked: true, value: 1 });
    expect(snapshot.bindings.some((binding) => binding.nodeId === "counter" && binding.property === "text")).toBe(true);
    expect(snapshot.callbacks.some((callback) => callback.nodeId === "btn" && callback.kind === "click")).toBe(true);
    expect(snapshot.intervals).toHaveLength(1);
    expect(snapshot.font).toHaveLength(1280);
  });
});
