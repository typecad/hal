// End-to-end: <canvas> + ui.drawCanvas lowers to C++ with the binding table
// and a draw wrapper whose body calls the ui_display_* shims.
// See docs/superpowers/specs/2026-06-27-canvas-element-design.md

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { transpileFile } from "@typecad/cuttlefish/testing";
import { resetUIRegistry } from "@typecad/ui/ui-engine/ui-registry";
import { resetUICallState } from "../../../packages/cuttlefish/src/ir/transformers/ui-call-resolver";
import { resetCanvasBindings } from "../../../packages/cuttlefish/src/ir/transformers/canvas-lowering";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const TMP_ROOT = path.join(REPO_ROOT, ".build", "ui-canvas-e2e");
const tempDirs: string[] = [];

afterEach(() => {
  for (const d of tempDirs.splice(0, tempDirs.length)) fs.rmSync(d, { recursive: true, force: true });
  resetUIRegistry();
  resetUICallState();
  resetCanvasBindings();
});

function mkTempDir(): string {
  const id = `t_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const dir = path.join(TMP_ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

describe("canvas e2e lowering", () => {
  it("emits a canvas draw wrapper with ui_display_* calls + binding table", async () => {
    const dir = mkTempDir();
    fs.writeFileSync(path.join(dir, "app.ui.html"), `<screen><canvas id="spark" width="60" height="30"></canvas></screen>`, "utf8");
    fs.writeFileSync(path.join(dir, "app.ui.css"), `#spark { width: 60px; height: 30px; }`, "utf8");
    fs.writeFileSync(path.join(dir, "main.ts"), [
      `import { ui } from "@typecad/ui";`,
      `import { screen } from "./app.ui.html";`,
      `ui.mount(screen, { display: "ili9341", bus: "SPI", cs: 10, dc: 9, rst: 8 });`,
      `ui.drawCanvas(screen.spark, (ctx) => {`,
      `  ctx.fillRect(0, 0, 60, 30, 'red');`,
      `  ctx.line(0, 15, ctx.width, 15, 'limegreen');`,
      `});`,
      `export function main() { while (true) {} }`,
    ].join("\n"), "utf8");

    const result = await transpileFile({
      inputFile: path.join(dir, "main.ts"),
      emitMode: "cpp",
      target: "arduino",
      frameworkPackage: "@typecad/framework-arduino",
      emitMaps: false,
    });
    const cpp = fs.readFileSync(result.sourcePath, "utf8");
    fs.unlinkSync(result.sourcePath);

    // Node table has a NODE_CANVAS row.
    expect(cpp).toContain("NODE_CANVAS");
    // Binding table is emitted.
    expect(cpp).toContain("UICanvasBinding __ui_canvas_bindings[]");
    expect(cpp).toContain("__ui_canvas_binding_count = 1");
    // The draw wrapper exists and contains lowered shim calls.
    expect(cpp).toMatch(/void __ui_canvas_draw_\d+\(CuttlefishCanvas16\* __c\)/);
    expect(cpp).toContain("ui_display_fill_rect(0, 0, 60, 30, 0xf800)");
    expect(cpp).toContain("ui_display_draw_line(0, 15, __ui_canvas_w, 15, 0x3666)");
  });
});
