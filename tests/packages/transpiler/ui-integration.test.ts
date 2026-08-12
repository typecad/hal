// ---------------------------------------------------------------------------
// End-to-end integration: a real multi-file UI program transpiled through
// transpileFile(), the same path `npx typecad build` takes.
//
// This is the North Star test for the UI wiring plan: it proves that an
// author's .ui.html + .ui.css + .ts program produces emitted C++ containing
// the runtime header, static tables, display init, and the per-loop driver.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { transpileFile } from "@typecad/cuttlefish/testing";
import { resetUIRegistry } from "@typecad/ui/ui-engine/ui-registry";
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
    display?: import("../../../packages/cuttlefish/src/api/shared/display-profile").DisplayConfig;
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
      display: opts.display,
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

  it("emits radio-group clearing with uint16_t member indexes past node 255", async () => {
    const padding = Array.from({ length: 260 }, (_, i) => `<text id="pad${i}">x</text>`).join("\n");
    const { cpp } = await transpileUIProgram({
      html: [
        `<screen>`,
        padding,
        `<radio id="r1" name="group" value="a" checked>A</radio>`,
        `<radio id="r2" name="group" value="b">B</radio>`,
        `</screen>`,
      ].join("\n"),
      css: ``,
      ts: [
        `import { ui } from "@typecad/ui";`,
        `import { screen } from "./app.ui.html";`,
        `ui.mount(screen, { display: "ili9341", bus: "SPI", cs: 10, dc: 9, rst: 8 });`,
        `export function main(): void { while (true) {} }`,
        ``,
      ].join("\n"),
    });

    expect(cpp).toMatch(/struct\s+UIRadioGroup\s*\{\s*uint16_t\s+nodeIndices\[8\];/);
    expect(cpp).toContain(`{ .nodeIndices={261, 262}, .count=2 },`);
    expect(cpp).toMatch(/void __ui_r1_autoclick\(\) \{ for \(uint8_t __r = 0; __r < __ui_radio_groups\[0\]\.count; __r\+\+\) \{ uint16_t __rn = __ui_radio_groups\[0\]\.nodeIndices\[__r\];/);
    expect(cpp).not.toMatch(/uint8_t __rn = __ui_radio_groups/);
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

  it("uses the project display profile when ui.mount omits options", async () => {
    const { cpp } = await transpileUIProgram({
      html: `<screen></screen>`,
      css: ``,
      display: {
        driver: "ili9341",
        bus: "SPI",
        cs: 10,
        dc: 9,
        rst: 8,
        width: 128,
        height: 64,
        colorFormat: "rgb565",
        rotation: 2,
      },
      ts: [
        `import { ui } from "@typecad/ui";`,
        `import { screen } from "./app.ui.html";`,
        `ui.mount(screen);`,
        `export function main(): void { while (true) {} }`,
        ``,
      ].join("\n"),
    });

    expect(cpp).toContain("Adafruit_ILI9341");
    expect(cpp).toContain(".begin()");
    expect(cpp).toContain(".setRotation(2)");
  });

  it("uses rotated visible dimensions for ST7796 UI layout", async () => {
    const { cpp } = await transpileUIProgram({
      html: `<screen></screen>`,
      css: `screen { background: #111418; }`,
      display: {
        profile: "st7796-spi",
        cs: 5,
        dc: 17,
        rst: 16,
      },
      ts: [
        `import { ui } from "@typecad/ui";`,
        `import { screen } from "./app.ui.html";`,
        `ui.mount(screen);`,
        ``,
      ].join("\n"),
    });

    expect(cpp).toContain("__tc_display.init(320, 480, 0, 0, ST7796S_RGB);");
    expect(cpp).toContain(".setRotation(1)");
    expect(cpp).toContain(".box={0,0,480,320}");
    expect(cpp).not.toContain(".box={0,0,320,480}");
  });

  it("initializes display hardware before touch and UI runtime setup", async () => {
    const { cpp } = await transpileUIProgram({
      html: `<screen></screen>`,
      css: ``,
      display: {
        driver: "ili9341",
        bus: "SPI",
        cs: 10,
        dc: 9,
        rst: 8,
        width: 320,
        height: 240,
        colorFormat: "rgb565",
        rotation: 1,
        touch: {
          library: "XPT2046_Touchscreen",
          cs: 7,
          irq: 6,
          calibration: { xMin: 0, xMax: 320, yMin: 0, yMax: 240 },
        },
      },
      ts: [
        `import { ui } from "@typecad/ui";`,
        `import { screen } from "./app.ui.html";`,
        `ui.mount(screen);`,
        ``,
      ].join("\n"),
    });

    const setupBody = cpp.match(/void setup\(\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const displayIdx = setupBody.indexOf("display_init();");
    const touchIdx = setupBody.indexOf("touch_init();");
    const uiIdx = setupBody.indexOf("ui_init();");
    expect(displayIdx).toBeGreaterThanOrEqual(0);
    expect(touchIdx).toBeGreaterThan(displayIdx);
    expect(uiIdx).toBeGreaterThan(touchIdx);
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

    // ui_tick must be driven by real elapsed time, not a fixed synthetic frame.
    expect(cpp).not.toContain("ui_tick(16)");
    expect(cpp).toContain("uint32_t __tc_ui_now = static_cast<uint32_t>(millis());");
    expect(cpp).toContain("static uint32_t __tc_ui_last_tick = __tc_ui_now;");
    expect(cpp).toContain("uint32_t __tc_ui_delta = __tc_ui_now - __tc_ui_last_tick;");
    expect(cpp).toContain("if (__tc_ui_delta > 250) __tc_ui_delta = 250;");
    expect(cpp).toContain("ui_tick(static_cast<uint16_t>(__tc_ui_delta));");
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

  it("lowers <range>.onChange as a rangechange handler table fired during drag", async () => {
    const { cpp } = await transpileUIProgram({
      html: `<screen><range id="brightness" min="0" max="100"></range></screen>`,
      css: `#brightness { width: 100%; height: 20px; }`,
      ts: [
        `import { ui } from "@typecad/ui";`,
        `import { screen } from "./app.ui.html";`,
        ``,
        `const brightness = ui.signal(50);`,
        `ui.mount(screen, { display: "ili9341", bus: "SPI", cs: 10, dc: 9, rst: 8 });`,
        `screen.brightness.onChange(() => { brightness.set(screen.brightness.value); });`,
        `export function main(): void { while (true) {} }`,
        ``,
      ].join("\n"),
    });

    // A rangechange handler function + per-node lookup table must be emitted.
    expect(cpp).toContain("__ui_rangechange_handlers");
    expect(cpp).toContain("__ui_rangechange_handler_count");
    // The callback function name follows the __ui_<id>_rangechange_<n> pattern.
    expect(cpp).toMatch(/__ui_brightness_rangechange_\d+/);
  });

  it("routes <input>.onChange to the change path, not rangechange", async () => {
    const { cpp } = await transpileUIProgram({
      html: `<screen><input id="ssid" type="text"></input></screen>`,
      css: `#ssid { width: 100%; height: 20px; }`,
      ts: [
        `import { ui } from "@typecad/ui";`,
        `import { screen } from "./app.ui.html";`,
        ``,
        `ui.mount(screen, { display: "ili9341", bus: "SPI", cs: 10, dc: 9, rst: 8 });`,
        `screen.ssid.onChange(() => {});`,
        `export function main(): void { while (true) {} }`,
        ``,
      ].join("\n"),
    });

    // Input onChange must NOT produce a rangechange handler function for the
    // input node (regression guard for the routing change that detects <range>
    // by node tag). Note: an empty rangechange table is always emitted for
    // symmetry with the click/hold/release tables.
    expect(cpp).not.toMatch(/__ui_ssid_rangechange_\d+/);
    expect(cpp).toContain("__ui_kb_set_onchange");
  });

  it("surfaces unknown CSS property and HTML tag warnings in output diagnostics", async () => {
    const { result } = await transpileUIProgram({
      html: `<screen><marquee id="m">x</marquee><text id="t">hi</text></screen>`,
      css: `#t { color: #fff; bogus-prop: red; }`,
      ts: [
        `import { ui } from "@typecad/ui";`,
        `import { screen } from "./app.ui.html";`,
        `ui.mount(screen, { display: "ili9341", bus: "SPI", cs: 10, dc: 9, rst: 8 });`,
        `export function main(): void { while (true) {} }`,
      ].join("\n"),
    });

    const msgs = result.diagnostics.map(d => d.message);
    // Unknown CSS property warning surfaces.
    expect(msgs.some(m => m.includes("bogus-prop"))).toBe(true);
    // Unknown HTML tag warning surfaces.
    expect(msgs.some(m => m.includes("marquee"))).toBe(true);
    // Known property/tag produce no warning.
    expect(msgs.some(m => m.includes("color"))).toBe(false);
  });
});
