import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { transpileFile } from "@typecad/cuttlefish/testing";
import { resetUIRegistry } from "@typecad/ui/ui-engine/ui-registry";
import { resetUICallState } from "../../../packages/cuttlefish/src/ir/transformers/ui-call-resolver";

// ---------------------------------------------------------------------------
// Compile-verification tier for UI callback lowering (ui.bind, ui.drawCanvas,
// onClick/onToggle/watchPin). These paths used to lower callback bodies via a
// hand-rolled statement walker that silently dropped const/let/if/for/while
// and mis-resolved conditional colors — producing C++ that either failed to
// compile with an error pointing at the wrong file/line, or "compiled" with
// the buggy statement quietly missing. Unit tests on the lowering functions
// catch the *shape* of the emitted text; this tier catches whether the whole
// generated translation unit actually compiles with a real host g++, which is
// the only way to be sure the fix generalizes across statement/expression
// combinations rather than the specific cases a hand-written unit test covers.
//
// Skips (not fails) when g++ or SDL2 dev headers aren't available on the host
// — mirrors the existing convention in native-demo-sdl-emit.test.ts, which
// defers the native SDL demo's own compile step the same way.
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "../../..");
const TMP_ROOT = path.join(REPO_ROOT, ".build", "ui-compile-verification");
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

/** Locate a directory containing SDL2/SDL.h so `#include <SDL2/SDL.h>` in the
 *  generated C++ resolves. Returns the include root (parent of the SDL2/
 *  folder), or undefined if SDL2 dev headers aren't found on this host. */
function findSdlIncludeRoot(): string | undefined {
  if (process.platform === "win32") {
    const candidates = ["C:\\msys64\\ucrt64\\include", "C:\\msys64\\mingw64\\include"];
    return candidates.find((dir) => fs.existsSync(path.join(dir, "SDL2", "SDL.h")));
  }
  // Common Linux/macOS locations (Homebrew, apt, etc). sdl2-config (if present)
  // is more authoritative but a plain -I fallback keeps this dependency-free.
  const candidates = ["/usr/include", "/usr/local/include", "/opt/homebrew/include"];
  return candidates.find((dir) => fs.existsSync(path.join(dir, "SDL2", "SDL.h")));
}

function hasGpp(): boolean {
  try {
    const result = spawnSync("g++", ["--version"], { encoding: "utf8" });
    return result.status === 0;
  } catch {
    return false;
  }
}

const sdlIncludeRoot = findSdlIncludeRoot();
const gppAvailable = hasGpp();
const canCompile = gppAvailable && !!sdlIncludeRoot;

/** Transpile a UI fixture (main.ts + app.ui.html) to native/SDL C++ and return
 *  the generated source text plus any diagnostics. */
async function transpileUiFixture(ts: string, html: string): Promise<{ cpp: string; diagnostics: { severity: string; message: string; code?: string }[] }> {
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
  return { cpp, diagnostics: result.diagnostics as never };
}

/** Compile-check (no link) a generated translation unit with a real host g++.
 *  Returns g++'s combined stdout+stderr; empty string on success. */
function compileCheck(cpp: string): string {
  const dir = mkTempDir();
  const cppPath = path.join(dir, "check.cpp");
  fs.writeFileSync(cppPath, cpp, "utf8");
  const objPath = path.join(dir, "check.o");
  const args = ["-std=c++17", "-fsyntax-only", "-Wall", "-Wno-unused-variable", "-Wno-unused-but-set-variable"];
  if (sdlIncludeRoot) args.push(`-I${sdlIncludeRoot}`, `-I${path.join(sdlIncludeRoot, "SDL2")}`);
  args.push(cppPath, "-o", objPath);
  const result = spawnSync("g++", args, { encoding: "utf8", timeout: 60_000 });
  if (result.status === 0) return "";
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
}

describe.skipIf(!canCompile)("UI callback compile-verification (host g++)", () => {
  it("compiles a drawCanvas callback with const/let + a for loop (gradient bar)", async () => {
    const { cpp, diagnostics } = await transpileUiFixture(
      [
        `import { ui } from "@typecad/ui";`,
        `import { screen } from "./app.ui.html";`,
        ``,
        `const level = ui.signal(50);`,
        `ui.mount(screen);`,
        `ui.drawCanvas(screen.gauge, (ctx) => {`,
        `  const barCount = 10;`,
        `  const filled = Math.floor((level() / 100) * barCount);`,
        `  for (let i = 0; i < barCount; i++) {`,
        `    const x = i * 12;`,
        `    const color = i < filled ? "#33cc33" : "#333333";`,
        `    ctx.fillRect(x, 0, 10, ctx.height, color);`,
        `  }`,
        `});`,
        `export function main(): void { while (true) {} }`,
      ].join("\n"),
      `<screen><canvas id="gauge" width="120" height="20"></canvas></screen>`,
    );
    expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    // The loop and its body must actually be present (not silently dropped).
    // Main IR pipeline emits a typed for-init (not the old string-baker `auto`).
    expect(cpp).toMatch(/for\s*\(\s*\w+\s+i\s*=\s*0;/);
    expect(cpp).toContain("ui_display_fill_rect(");
    const errors = compileCheck(cpp);
    expect(errors).toBe("");
  });

  it("compiles an onClick callback with a const declaration", async () => {
    const { cpp, diagnostics } = await transpileUiFixture(
      [
        `import { ui } from "@typecad/ui";`,
        `import { screen } from "./app.ui.html";`,
        ``,
        `const count = ui.signal(0);`,
        `ui.mount(screen);`,
        `screen.btn.onClick(() => {`,
        `  const next = count() + 1;`,
        `  count.set(next);`,
        `});`,
        `export function main(): void { while (true) {} }`,
      ].join("\n"),
      `<screen><button id="btn">tap</button></screen>`,
    );
    expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(cpp).toMatch(/\w+\s+next\s*=/);
    const errors = compileCheck(cpp);
    expect(errors).toBe("");
  });

  it("compiles a text binding whose template literal interpolates Math.floor()", async () => {
    const { cpp, diagnostics } = await transpileUiFixture(
      [
        `import { ui } from "@typecad/ui";`,
        `import { screen } from "./app.ui.html";`,
        ``,
        `const raw = ui.signal(72.4);`,
        `ui.mount(screen);`,
        `ui.bind(screen.out, "text", () => \`temp: \${Math.floor(raw())}C\`);`,
        `export function main(): void { while (true) {} }`,
      ].join("\n"),
      `<screen><text id="out">x</text></screen>`,
    );
    expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    const errors = compileCheck(cpp);
    expect(errors).toBe("");
  });
});
