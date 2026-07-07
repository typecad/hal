import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { transpileFile } from "@typecad/cuttlefish/testing";
import { resetUIRegistry } from "@typecad/cuttlefish/ui/ui-registry";
import { resetUICallState } from "../../../packages/cuttlefish/src/ir/transformers/ui-call-resolver";

// ui.window.setTitle / setIcon — native desktop window controls. On SDL these
// lower to ui_window_set_title(SDL_SetWindowTitle); on hardware they're silent
// no-ops (no window on Arduino/AVR/ESP32). Tests both targets to lock the gate.

const REPO_ROOT = path.resolve(__dirname, "../../..");
const TMP_ROOT = path.join(REPO_ROOT, ".build", "ui-window-api");
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

async function transpile(target: "native" | "arduino", ts: string): Promise<string> {
  const dir = mkTempDir();
  fs.writeFileSync(path.join(dir, "app.ui.html"), `<screen><text id="out">x</text></screen>`, "utf8");
  fs.writeFileSync(path.join(dir, "app.ui.css"), `#out { color: #fff; font: 8x16; }`, "utf8");
  fs.writeFileSync(path.join(dir, "main.ts"), ts, "utf8");
  const result = await transpileFile({
    inputFile: path.join(dir, "main.ts"),
    emitMode: "cpp",
    target: target === "native" ? "native" : "arduino",
    frameworkPackage: target === "native" ? "@typecad/framework-native" : "@typecad/framework-arduino",
    emitMaps: false,
    display: target === "native"
      ? ({ driver: "sdl", width: 320, height: 240 } as never)
      : ({ driver: "ili9341", bus: "SPI", cs: 10, dc: 9, rst: 8 } as never),
  });
  const cpp = fs.readFileSync(result.sourcePath, "utf8");
  fs.unlinkSync(result.sourcePath);
  return cpp;
}

describe("ui.window API lowering", () => {
  it("SDL target: ui.window.setTitle with a string literal lowers to ui_window_set_title", async () => {
    const cpp = await transpile("native", [
      `import { ui } from "@typecad/ui";`,
      `import { screen } from "./app.ui.html";`,
      `ui.mount(screen);`,
      `ui.window.setTitle("hello");`,
      `export function main(): void { while (true) {} }`,
    ].join("\n"));
    expect(cpp).toContain("ui_window_set_title");
    expect(cpp).toContain('"hello"');
  });

  it("SDL target: ui.window.setTitle with a template literal builds snprintf + ui_window_set_title", async () => {
    // The bug: `taps: ${count}` was rendered as the literal string "taps: " + count
    // instead of snprintf(__title, ..., "taps: %d", count). Must produce a
    // format string with %d and pass the interpolated variable.
    const cpp = await transpile("native", [
      `import { ui } from "@typecad/ui";`,
      `import { screen } from "./app.ui.html";`,
      `const count = ui.signal(0);`,
      `ui.mount(screen);`,
      `ui.window.setTitle(\`taps: \${count}\`);`,
      `export function main(): void { while (true) {} }`,
    ].join("\n"));
    expect(cpp).toContain("snprintf");
    expect(cpp).toContain("ui_window_set_title");
    // The format string must contain the literal "taps: " and a %d for count.
    expect(cpp).toMatch(/"taps: %d"/);
    // The count variable (lowered from the signal) must appear as a snprintf arg.
    expect(cpp).toMatch(/snprintf[\s\S]*"taps: %d"[\s\S]*count/);
  });

  it("Arduino target: ui.window.setTitle is a silent no-op (no ui_window_set_title emitted)", async () => {
    const cpp = await transpile("arduino", [
      `import { ui } from "@typecad/ui";`,
      `import { screen } from "./app.ui.html";`,
      `ui.mount(screen);`,
      `ui.window.setTitle("hello");`,
      `export function main(): void { while (true) {} }`,
    ].join("\n"));
    expect(cpp).not.toContain("ui_window_set_title");
  });
});
