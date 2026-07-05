import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { transpileFile } from "@typecad/cuttlefish/testing";
import { resetUIRegistry } from "@typecad/cuttlefish/ui/ui-registry";
import { resetUICallState } from "../../../packages/cuttlefish/src/ir/transformers/ui-call-resolver";

// Parity: a ui.bind body with arithmetic must lower the same way the statement
// renderer would, so the device and the preview agree on the value. The
// binding/callback lowering path used to render expressions via
// renderExprAsText (strategy-unaware), so `value / 2` became integer division
// on the device even on the native target (which promotes to double everywhere
// else via ExpressionRenderer.renderBinary + strategy.promoteDivisionToDouble).
//
// This locks down the fix: binding bodies route through the strategy-aware
// ExpressionRenderer, so the native target emits static_cast<double>(...) for
// division exactly like top-level code does.

const REPO_ROOT = path.resolve(__dirname, "../../..");
const TMP_ROOT = path.join(REPO_ROOT, ".build", "ui-e2e-parity");
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

async function transpileNative(ts: string, html = `<screen><text id="out">x</text></screen>`): Promise<string> {
  const dir = mkTempDir();
  fs.writeFileSync(path.join(dir, "app.ui.html"), html, "utf8");
  fs.writeFileSync(path.join(dir, "app.ui.css"), `#out { color: #fff; font: 8x16; }`, "utf8");
  fs.writeFileSync(path.join(dir, "main.ts"), ts, "utf8");
  const result = await transpileFile({
    inputFile: path.join(dir, "main.ts"),
    emitMode: "cpp",
    target: "native",
    frameworkPackage: "@typecad/framework-native",
    emitMaps: false,
    display: { driver: "sdl", width: 320, height: 240 } as never,
  });
  const cpp = fs.readFileSync(result.sourcePath, "utf8");
  fs.unlinkSync(result.sourcePath);
  return cpp;
}

describe("ui.bind expression parity with the statement renderer", () => {
  it("promotes division to double on the native target in a value binding", async () => {
    const cpp = await transpileNative([
      `import { ui } from "@typecad/ui";`,
      `import { screen } from "./app.ui.html";`,
      ``,
      `ui.mount(screen);`,
      `ui.bind(screen.out, "value", () => screen.out.value / 2);`,
      `export function main(): void { while (true) {} }`,
    ].join("\n"));

    // The compute function for the binding must wrap the division in
    // static_cast<double>(...) — same as top-level code on the native target.
    const fnLine = cpp.split("\n").find((l) => l.includes("__ui_bind_value_") && l.includes("return"));
    expect(fnLine).toBeDefined();
    expect(fnLine!).toContain("static_cast<double>");
    expect(fnLine!).toContain("/");
  });
});
