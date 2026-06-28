// End-to-end: `await ui.onTap()` inside an async function lowers to a
// cooperative state machine that polls the runtime tap counter.
// See docs/superpowers/specs/2026-06-27-ui-ontap-awaitable-design.md

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { transpileFile } from "@typecad/cuttlefish/testing";
import { resetUIRegistry } from "@typecad/cuttlefish/ui/ui-registry";
import { resetUICallState } from "../../../packages/cuttlefish/src/ir/transformers/ui-call-resolver";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const TMP_ROOT = path.join(REPO_ROOT, ".build", "ui-ontap-e2e");

const tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  resetUIRegistry();
  resetUICallState();
});

function mkTempDir(): string {
  const id = `t_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const dir = path.join(TMP_ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

async function transpileUIProgram(ts: string, html = `<screen></screen>`): Promise<string> {
  const dir = mkTempDir();
  fs.writeFileSync(path.join(dir, "app.ui.html"), html, "utf8");
  fs.writeFileSync(path.join(dir, "app.ui.css"), ``, "utf8");
  fs.writeFileSync(path.join(dir, "main.ts"), ts, "utf8");

  // Generic target: async functions lower fully to cooperative state machines
  // here (arduino currently stubs async — see TS2CPP_ASYNC_STUB). The tap poll
  // state machine is target-independent, so generic is the right level to test.
  const result = await transpileFile({
    inputFile: path.join(dir, "main.ts"),
    emitMode: "cpp",
    target: "generic",
    frameworkPackage: "@typecad/framework-arduino",
    emitMaps: false,
  });

  const cpp = fs.readFileSync(result.sourcePath, "utf8");
  fs.unlinkSync(result.sourcePath);
  return cpp;
}

describe("ui.onTap end-to-end lowering", () => {
  it("emits a tap-counter poll state for `await ui.onTap()`", async () => {
    const cpp = await transpileUIProgram([
      `import { ui } from "@typecad/ui";`,
      `import { screen } from "./app.ui.html";`,
      `ui.mount(screen, { display: "ili9341", bus: "SPI", cs: 10, dc: 9, rst: 8 });`,
      ``,
      `export async function screensaver() {`,
      `  while (true) {`,
      `    await ui.onTap();`,
      `  }`,
      `}`,
      ``,
      `export function main(): void {`,
      `  screensaver();`,
      `  while (true) { /* keep alive */ }`,
      `}`,
      ``,
    ].join("\n"));

    // The async task must read the runtime tap counter to detect a new tap.
    expect(cpp).toContain("__ui_tap_seq");
    // A snapshot is captured into a per-await member and compared each tick.
    expect(cpp).toMatch(/_tapPrev_/);
    expect(cpp).toMatch(/__ui_tap_seq\s*!=\s*_tapPrev_/);
  });

  it("emits a per-node tap filter for `await ui.onTap(screen.x)`", async () => {
    const cpp = await transpileUIProgram(
      [
        `import { ui } from "@typecad/ui";`,
        `import { screen } from "./app.ui.html";`,
        `ui.mount(screen, { display: "ili9341", bus: "SPI", cs: 10, dc: 9, rst: 8 });`,
        ``,
        `export async function wizard() {`,
        `  await ui.onTap(screen.x);`,
        `}`,
        ``,
        `export function main(): void {`,
        `  wizard();`,
        `  while (true) { /* keep alive */ }`,
        `}`,
        ``,
      ].join("\n"),
      `<screen><button id="x">go</button></screen>`,
    );

    // Per-node form additionally checks __ui_tap_node against the node index.
    expect(cpp).toContain("__ui_tap_seq");
    expect(cpp).toContain("__ui_tap_node");
  });
});
