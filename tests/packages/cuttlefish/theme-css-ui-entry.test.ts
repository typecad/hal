import { describe, it, expect } from "vitest";
import path from "node:path";
import { loadCuttlefishConfig } from "../../../packages/cuttlefish/src/config-loader";
import { transpileFile } from "../../../packages/cuttlefish/src/transpile";

describe("themeCss with .ui single-file entry", () => {
  it("warns that themeCss is ignored for a .ui entry (demo-st)", async () => {
    // demo-st's entry is a .ui single-file component. Drive transpileFile with
    // an explicit display.themeCss set (rather than reading the live demo-st
    // config, which may have themeCss commented out as a config choice) so the
    // test exercises the warning logic, not the current config state.
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
      // Force themeCss on for this test (the entry is .ui → warning must fire).
      display: { ...(cfg.display ?? { profile: "st7796-spi" }), themeCss: "./theme.css" },
      skipTypeCheck: true,
    } as any);
    expect(result.diagnostics.some(d => d.code === "themeCss-ui-entry-ignored")).toBe(true);
  });
});
