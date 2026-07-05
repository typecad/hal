import { describe, it, expect } from "vitest";
import path from "node:path";
import { loadCuttlefishConfig } from "../../../packages/cuttlefish/src/config-loader";
import { transpileFile } from "../../../packages/cuttlefish/src/transpile";

describe("themeCss with .ui single-file entry", () => {
  it("warns that themeCss is ignored for a .ui entry (demo-st)", async () => {
    // demo-st's config sets display.themeCss AND uses a .ui entry — exactly
    // the silent-ignore case. The framework + board packages resolve via the
    // workspace root (the test runs at the repo root).
    const configDir = path.resolve("demo-st");
    const cfg = loadCuttlefishConfig(configDir);
    if (!cfg) throw new Error("demo-st config not found");
    const entryFile = cfg.entry ? path.resolve(configDir, cfg.entry) : path.join(configDir, "src", "showcase.ui");
    const result = await transpileFile({
      inputFile: entryFile,
      emitMode: "split",
      target: cfg.target ?? "esp32",
      emitMaps: false,
      frameworkPackage: cfg.framework,
      boardPackage: cfg.board,
      display: cfg.display,
      skipTypeCheck: true,
    } as any);
    expect(result.diagnostics.some(d => d.code === "themeCss-ui-entry-ignored")).toBe(true);
  });
});
