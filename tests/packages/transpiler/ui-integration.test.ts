// ---------------------------------------------------------------------------
// End-to-end integration: a real multi-file UI program transpiled through
// transpileFile(), the same path `npx typehal build` takes.
//
// This is the North Star test for the UI wiring plan: it proves that an
// author's .ui.html + .ui.css + .ts program produces emitted C++ containing
// the runtime header, static tables, display init, and the per-loop driver.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { transpileFile } from "@typecad/cuttlefish/testing";
import { resetUIRegistry } from "@typecad/cuttlefish/ui/ui-registry";
import { resetUICallState } from "../../../packages/cuttlefish/src/ir/transformers/ui-call-resolver";

// Tests must run inside the repo tree so @typecad/ui (a workspace package
// symlinked into node_modules) resolves during the type-check phase.
const REPO_ROOT = path.resolve(__dirname, "../../..");
const TMP_ROOT = path.join(REPO_ROOT, ".build", "ui-e2e");

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

describe("UI end-to-end via transpileFile", () => {
  // Helper: write a 3-file UI program and transpile it. Uses the arduino
  // target + ILI9341 driver (the PoC driver per the spec); transpileFile
  // only emits C++, it does not compile to hardware.
  async function transpileUIProgram(opts: {
    html: string;
    css: string;
    ts: string;
  }) {
    const dir = mkTempDir();

    fs.writeFileSync(path.join(dir, "app.ui.html"), opts.html, "utf8");
    fs.writeFileSync(path.join(dir, "app.ui.css"), opts.css, "utf8");
    fs.writeFileSync(path.join(dir, "main.ts"), opts.ts, "utf8");

    const result = await transpileFile({
      inputFile: path.join(dir, "main.ts"),
      emitMode: "cpp",
      target: "arduino",
      frameworkPackage: "@typecad/framework-arduino",
      emitMaps: false,
    });

    const cpp = fs.readFileSync(result.sourcePath, "utf8");
    fs.unlinkSync(result.sourcePath);
    return { cpp, result };
  }

  it("emits the UI runtime header (UINode struct + ui_tick)", async () => {
    const { cpp } = await transpileUIProgram({
      html: `<screen><text id="greeting">hello world</text></screen>`,
      css: `screen { background: #008000; padding: 8; } #greeting { color: #ff0000; font: 8x16; }`,
      ts: [
        `import { ui } from "@typecad/ui";`,
        `import { screen } from "./app.ui.html";`,
        `ui.mount(screen, { display: "ili9341", bus: "SPI", cs: 10, dc: 9, rst: 8 });`,
        ``,
        `export function main(): void {`,
        `  while (true) { /* keep main alive */ }`,
        `}`,
        ``,
      ].join("\n"),
    });

    expect(cpp).toMatch(/struct\s+UINode/);
    expect(cpp).toContain("ui_tick");
    expect(cpp).toContain("lerp_color");
  });

  it("emits the static node table with resolved colors", async () => {
    const { cpp } = await transpileUIProgram({
      html: `<screen><text id="greeting">hello world</text></screen>`,
      css: `screen { background: #008000; } #greeting { color: #ff0000; font: 8x16; }`,
      ts: [
        `import { ui } from "@typecad/ui";`,
        `import { screen } from "./app.ui.html";`,
        `ui.mount(screen, { display: "ili9341", bus: "SPI", cs: 10, dc: 9, rst: 8 });`,
        ``,
        `export function main(): void { while (true) {} }`,
        ``,
      ].join("\n"),
    });

    expect(cpp).toMatch(/UINode\s+__ui_nodes/);
    expect(cpp).toContain("hello world");
    // #008000 → 0x0400 (half green); #ff0000 → 0xf800 (pure red)
    expect(cpp).toContain("0x0400");
    expect(cpp).toContain("0xf800");
  });

  it("emits display.init through the ILI9341 library driver", async () => {
    const { cpp } = await transpileUIProgram({
      html: `<screen></screen>`,
      css: ``,
      ts: [
        `import { ui } from "@typecad/ui";`,
        `import { screen } from "./app.ui.html";`,
        `ui.mount(screen, { display: "ili9341", bus: "SPI", cs: 10, dc: 9, rst: 8 });`,
        `export function main(): void { while (true) {} }`,
        ``,
      ].join("\n"),
    });

    // The ILI9341 driver instantiates Adafruit_ILI9341 + begin() on init.
    expect(cpp).toContain("Adafruit_ILI9341");
    expect(cpp).toContain(".begin()");
    expect(cpp).toContain(".setRotation(1)");
  });

  it("emits ui_tick in the driver function body", async () => {
    const { cpp } = await transpileUIProgram({
      html: `<screen></screen>`,
      css: ``,
      ts: [
        `import { ui } from "@typecad/ui";`,
        `import { screen } from "./app.ui.html";`,
        `ui.mount(screen, { display: "ili9341", bus: "SPI", cs: 10, dc: 9, rst: 8 });`,
        `export function main(): void { while (true) {} }`,
        ``,
      ].join("\n"),
    });

    // ui_tick must appear inside a function body (indented), not at file scope.
    expect(cpp).toMatch(/^\s+ui_tick\(/m);
  });

  it("lowers const pressed = ui.signal(0) + pressed.set() in a timer callback", async () => {
    // Mirrors the demo's working pattern: the signal is declared at top level
    // and used inside a setInterval callback (which is hoisted to a free
    // function, keeping the signal alive through tree-shaking).
    const { cpp } = await transpileUIProgram({
      html: `<screen></screen>`,
      css: ``,
      ts: [
        `import { ui } from "@typecad/ui";`,
        `import { screen } from "./app.ui.html";`,
        ``,
        `ui.mount(screen, { display: "ili9341", bus: "SPI", cs: 10, dc: 9, rst: 8 });`,
        `const pressed = ui.signal(0);`,
        `setInterval(() => { pressed.set(1); }, 1000);`,
        `export function main(): void { while (true) {} }`,
        ``,
      ].join("\n"),
    });

    // The signal lowers to a mutable device variable; .set() lowers to =.
    // The hoisted timer callback references it, so it survives tree-shaking.
    expect(cpp).toMatch(/int\s+pressed/);
    expect(cpp).toContain("__tc_timer_cb");
  });

  it("emits a diagnostic for an unsupported display driver", async () => {
    const dir = mkTempDir();
    fs.writeFileSync(path.join(dir, "app.ui.html"), `<screen></screen>`, "utf8");
    fs.writeFileSync(path.join(dir, "app.ui.css"), ``, "utf8");
    fs.writeFileSync(
      path.join(dir, "main.ts"),
      [
        `import { ui } from "@typecad/ui";`,
        `import { screen } from "./app.ui.html";`,
        `ui.mount(screen, { display: "st7789", bus: "SPI", cs: 10, dc: 9, rst: 8 });`,
        `export function main(): void { while (true) {} }`,
        ``,
      ].join("\n"),
      "utf8",
    );

    // The mount validation throws; transpileFile surfaces it as a rejection.
    await expect(
      transpileFile({
        inputFile: path.join(dir, "main.ts"),
        emitMode: "cpp",
        target: "native",
        mcu: "@typecad/mcu-generic",
        emitMaps: false,
      }),
    ).rejects.toThrow(/st7789|Unsupported/i);
  });

  it("lowers ui.bind without tripping the Function.prototype.bind semantic gate", async () => {
    const { cpp } = await transpileUIProgram({
      html: `<screen><text id="greeting">hi</text></screen>`,
      css: `#greeting { color: #ff0000; font: 8x16; }`,
      ts: [
        `import { ui } from "@typecad/ui";`,
        `import { screen } from "./app.ui.html";`,
        ``,
        `const temp = ui.signal(0);`,
        `ui.mount(screen, { display: "ili9341", bus: "SPI", cs: 10, dc: 9, rst: 8 });`,
        `ui.bind(screen.greeting, "background", () => (temp() > 0 ? "#ff0000" : "#000000"));`,
        `export function main(): void { while (true) {} }`,
        ``,
      ].join("\n"),
    });

    // ui.bind must pass the semantic gate (no TS2CPP_NO_EQUIVALENT abort) and
    // produce a binding-table entry in the emitted C++.
    expect(cpp).toContain("UIBinding");
    expect(cpp).toContain("__ui_bindings");
  });
});
