import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { transpileFile } from "@typecad/cuttlefish/testing";
import { resetUIRegistry } from "@typecad/cuttlefish/ui/ui-registry";
import { resetUICallState } from "../../../packages/cuttlefish/src/ir/transformers/ui-call-resolver";

// Parity for callback bodies (onClick, watchPin, bindInput): arithmetic in
// a callback must lower the same way top-level code does. Callback bodies now
// route through lowerCallbackStatements → StatementRenderer, so division
// promotion must match the main pipeline.

const REPO_ROOT = path.resolve(__dirname, "../../..");
const TMP_ROOT = path.join(REPO_ROOT, ".build", "ui-e2e-parity-cb");
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

async function transpileNative(ts: string, html = `<screen><button id="btn">Go</button></screen>`): Promise<string> {
  const dir = mkTempDir();
  fs.writeFileSync(path.join(dir, "app.ui.html"), html, "utf8");
  fs.writeFileSync(path.join(dir, "app.ui.css"), `#btn { color: #fff; font: 8x16; }`, "utf8");
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

describe("ui callback expression parity with the statement renderer", () => {
  it("promotes division to double in an onClick callback on the native target", async () => {
    // Prefer onClick + signal over watchPin: native has no GPIO model, and
    // watchPin would fatal with gpio-unsupported-on-target.
    const cpp = await transpileNative([
      `import { ui } from "@typecad/ui";`,
      `import { screen } from "./app.ui.html";`,
      ``,
      `const level = ui.signal(10);`,
      `ui.mount(screen);`,
      `screen.btn.onClick(() => { level.set(level() / 2); });`,
      `export function main(): void { while (true) {} }`,
    ].join("\n"));

    // Find the synthesized click wrapper and assert the division is promoted.
    const body = cpp.split("\n").filter((l) => l.includes("level") && l.includes("/")).join("\n");
    expect(body.length).toBeGreaterThan(0);
    expect(body).toMatch(/static_cast<\s*double\s*>/);
  });
});
