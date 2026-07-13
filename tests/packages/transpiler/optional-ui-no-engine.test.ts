// Regression test: transpileFile() and the CLI build path must succeed for a
// plain TypeScript sketch when @typecad/ui is NOT installed.
//
// The UI hook contract (packages/cuttlefish/src/ui-hook.ts) says requireUIHook()
// must only be called inside `if (entryHasUI())` / `if (hasUIHook())` guards.
// Several call sites in cli.ts, transpile.ts, and type-checker.ts violated that
// contract by calling requireUIHook() unconditionally, which threw the
// "UI hook is not registered" error on every non-UI build in a project that
// does not depend on @typecad/ui (the documented optional package).
//
// This test reproduces that end-user environment by forcing the bridge into the
// "no @typecad/ui" state (the global vitest setup otherwise eagerly registers
// @typecad/ui's engine, and loadUIEngine() would re-arm it on every run).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { transpileFile, __simulateUIAbsentForTest, resetUIEngine } from "../../../packages/cuttlefish/src/testing";
import { hasUIHook } from "../../../packages/cuttlefish/src/ui-hook";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dirPath of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
  // Re-arm the UI engine for subsequent tests (monorepo has @typecad/ui).
  resetUIEngine();
});

function writeProject(entrySource: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cfish-no-ui-"));
  tempDirs.push(dir);
  fs.writeFileSync(path.join(dir, "main.ts"), entrySource);
  return dir;
}

describe("optional @typecad/ui: non-UI sketch transpiles without the UI engine", () => {
  it("transpileFile succeeds for a plain sketch when the UI engine is absent", async () => {
    __simulateUIAbsentForTest();
    expect(hasUIHook()).toBe(false);

    const dir = writeProject(`
      // Plain non-UI sketch — no @typecad/ui import, no .ui/.ui.html files.
      function setup(): void {}
      function loop(): void {}
    `);

    // loadUIEngine() inside transpileFile must leave the hook null (the
    // simulated-absent state) and the unguarded requireUIHook() call sites
    // must not throw.
    let result: Awaited<ReturnType<typeof transpileFile>>;
    try {
      result = await transpileFile({
        inputFile: path.join(dir, "main.ts"),
        target: "avr",
        boardPackage: "@typecad/board-arduino-uno",
        frameworkPackage: "@typecad/framework-arduino",
        skipTypeCheck: true,
        skipLint: true,
      });
    } catch (e) {
      throw new Error(
        `transpileFile threw on a non-UI sketch with no UI engine:\n${(e as Error).message}`,
      );
    }

    expect(result.sourcePath).toBeTruthy();
    // The hook must still be null — transpileFile must not have armed it when
    // the engine is absent.
    expect(hasUIHook()).toBe(false);
  });

  it("transpileFile succeeds for a plain sketch when type-checking is enabled", async () => {
    // type-checker.ts also calls requireUIHook() unconditionally; this variant
    // exercises that path (skipTypeCheck: false).
    __simulateUIAbsentForTest();
    expect(hasUIHook()).toBe(false);

    const dir = writeProject(`
      function setup(): void {}
      function loop(): void {}
    `);

    let result: Awaited<ReturnType<typeof transpileFile>>;
    try {
      result = await transpileFile({
        inputFile: path.join(dir, "main.ts"),
        target: "avr",
        boardPackage: "@typecad/board-arduino-uno",
        frameworkPackage: "@typecad/framework-arduino",
        skipTypeCheck: false,
        skipLint: true,
      });
    } catch (e) {
      throw new Error(
        `transpileFile threw with type-checking on a non-UI sketch:\n${(e as Error).message}`,
      );
    }

    expect(result.sourcePath).toBeTruthy();
    expect(hasUIHook()).toBe(false);
  });
});
