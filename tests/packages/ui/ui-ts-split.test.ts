// ---------------------------------------------------------------------------
// UI + plain-TS split: verify the "main.ts as entry, .ui/.ui.html handles only
// display" layout works end-to-end. main.ts imports `screen` from the UI file
// AND a sensor function from a sibling .ts, then marries them in a setInterval
// callback. This is the recommended structure when sensor/IO logic is factored
// out of the display file.
//
// Asserts the structural pieces land in the emitted C++:
//   - the cross-module sensor call (readVolts) survives lowering into the timer
//   - the .value write lowers to a node-table write + dirty mark
//   - the UI runtime (node table + ui_tick) is present
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { transpileFile } from "@typecad/cuttlefish/testing";
import { resetUIRegistry } from "@typecad/ui/ui-engine/ui-registry";
import { resetUICallState } from "../../../packages/cuttlefish/src/ir/transformers/ui-call-resolver";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const TMP_ROOT = path.join(REPO_ROOT, ".build", "ui-split-e2e");
const tempDirs: string[] = [];

afterEach(() => {
  for (const d of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  resetUIRegistry();
  resetUICallState();
});

function mkTempDir(): string {
  const dir = path.join(TMP_ROOT, `t_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

describe("main.ts entry + .ui.html display split", () => {
  it("main.ts imports screen + a sensor fn from a sibling .ts and wires them in setInterval", async () => {
    const dir = mkTempDir();

    // sensors.ts — plain cuttlefish TS, no UI imports. Owns the device I/O.
    fs.writeFileSync(
      path.join(dir, "sensors.ts"),
      [
        `import { A0 } from "@typecad/board-arduino-uno";`,
        `const adc = A0.asInput();`,
        `export function readVolts(): number {`,
        `  return adc.readVoltage();`,
        `}`,
        ``,
      ].join("\n"),
      "utf8",
    );

    // app.ui.html — display only. <range> exposes a writable .value.
    fs.writeFileSync(path.join(dir, "app.ui.html"), `<screen><range id="meter" min="0" max="330"></range></screen>`, "utf8");
    fs.writeFileSync(path.join(dir, "app.ui.css"), `screen { background: #000; } #meter { color: #0f0; }`, "utf8");

    // main.ts — the entry. Imports the screen AND the sensor logic, marries them.
    fs.writeFileSync(
      path.join(dir, "main.ts"),
      [
        `import { ui } from "@typecad/ui";`,
        `import { screen } from "./app.ui.html";`,
        `import { readVolts } from "./sensors.js";`,
        ``,
        `ui.mount(screen, { display: "ili9341", bus: "SPI", cs: 10, dc: 9, rst: 8 });`,
        ``,
        `setInterval(() => {`,
        `  screen.meter.value = Math.round(readVolts() * 100);`,
        `}, 500);`,
        ``,
        `export function main(): void { while (true) {} }`,
        ``,
      ].join("\n"),
      "utf8",
    );

    const result = await transpileFile({
      inputFile: path.join(dir, "main.ts"),
      emitMode: "cpp",
      target: "arduino",
      frameworkPackage: "@typecad/framework-arduino",
      emitMaps: false,
    });

    const cpp = fs.readFileSync(result.sourcePath, "utf8");
    fs.unlinkSync(result.sourcePath);

    // The cross-module sensor call survives lowering into the timer callback.
    expect(cpp).toMatch(/readVolts\(\)/);
    // The .value write lowers to a node-table write followed by a dirty mark.
    expect(cpp).toMatch(/__ui_nodes\[\d+\]\.value\s*=\s*round\(readVolts\(\)/);
    expect(cpp).toMatch(/ui_mark_dirty\(\d+\)/);
    // The setInterval registered the timer callback in setup().
    expect(cpp).toMatch(/__tc_setInterval\(__tc_timer_cb_\d+,\s*500\)/);
    // The UI runtime is present (node table + tick driver).
    expect(cpp).toMatch(/struct\s+UINode/);
    expect(cpp).toContain("ui_tick");
  });
});
