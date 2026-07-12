import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { transpileFile } from "@typecad/cuttlefish/testing";
import { resetUIRegistry } from "@typecad/ui/ui-engine/ui-registry";
import { resetUICallState } from "../../../packages/cuttlefish/src/ir/transformers/ui-call-resolver";

// ui.watchPin is a GPIO-hardware API: it has no equivalent on the SDL desktop
// target (no GPIO pins). The native shim's `digitalRead` returns constant LOW
// and `pinMode`/`attachInterrupt` are undefined → on native this API either
// silently never fires or fails at link time. The right behavior is a clear
// transpile-time diagnostic so the author learns immediately, instead of
// debugging a silent no-op or a linker error.

const REPO_ROOT = path.resolve(__dirname, "../../..");
const TMP_ROOT = path.join(REPO_ROOT, ".build", "ui-gpio-diag");
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

async function transpile(target: "native" | "arduino", ts: string): Promise<{ cpp: string; diagnostics: { message: string; code?: string }[] }> {
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
    diagnostics: true,
    display: target === "native"
      ? ({ driver: "sdl", width: 320, height: 240 } as never)
      : ({ driver: "ili9341", bus: "SPI", cs: 10, dc: 9, rst: 8 } as never),
  });
  const cpp = fs.readFileSync(result.sourcePath, "utf8");
  fs.unlinkSync(result.sourcePath);
  return { cpp, diagnostics: (result.diagnostics ?? []).map((d) => ({ message: d.message, code: d.code })) };
}

describe("ui.watchPin on native: GPIO diagnostic", () => {
  it("native target aborts transpile with a clear gpio-unsupported error (no silent no-op)", async () => {
    // The diagnostic is severity:error, so transpileFile throws it as a fatal
    // diagnostic before emitting C++. That's the intended behavior — a GPIO API
    // on a no-GPIO target should fail loudly at transpile, not produce a binary
    // that silently never fires or fails to link.
    await expect(transpile("native", [
      `import { ui } from "@typecad/ui";`,
      `import { screen } from "./app.ui.html";`,
      `ui.mount(screen);`,
      `ui.watchPin(4, () => {});`,
      `export function main(): void { while (true) {} }`,
    ].join("\n"))).rejects.toThrow(/gpio-unsupported-on-target[\s\S]*ui\.watchPin[\s\S]*GPIO/i);
  });

  it("arduino target still emits pinMode/attachInterrupt with NO diagnostic (regression guard)", async () => {
    const { diagnostics, cpp } = await transpile("arduino", [
      `import { ui } from "@typecad/ui";`,
      `import { screen } from "./app.ui.html";`,
      `ui.mount(screen);`,
      `ui.watchPin(4, () => {});`,
      `export function main(): void { while (true) {} }`,
    ].join("\n"));
    const gpioDiag = diagnostics.find((d) => /watchPin|GPIO|gpio/i.test(d.message));
    expect(gpioDiag).toBeUndefined();
    expect(cpp).toContain("pinMode(4");
    expect(cpp).toContain("INPUT_PULLUP");
  });
});
