// Regression test: transpileFile() must succeed for a plain TypeScript sketch
// when @typecad/safety is NOT installed.
//
// The safety hook contract (packages/cuttlefish/src/safety-hook.ts) says
// requireSafetyHook() must only be called inside `if (hasSafetyHook())`
// guards. This test reproduces the end-user environment by forcing the bridge
// into the "no @typecad/safety" state.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { transpileFile, __simulateSafetyAbsentForTest, resetSafetyEngine } from "../../../packages/cuttlefish/src/testing";
import { hasSafetyHook } from "../../../packages/cuttlefish/src/safety-hook";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dirPath of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
  // Re-arm the safety engine for subsequent tests (monorepo has @typecad/safety).
  resetSafetyEngine();
});

function writeProject(entrySource: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cfish-no-safety-"));
  tempDirs.push(dir);
  fs.writeFileSync(path.join(dir, "main.ts"), entrySource);
  return dir;
}

describe("optional @typecad/safety: non-safety sketch transpiles without the safety engine", () => {
  it("transpileFile succeeds for a plain sketch when the safety engine is absent", async () => {
    __simulateSafetyAbsentForTest();
    expect(hasSafetyHook()).toBe(false);

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
        skipTypeCheck: true,
        skipLint: true,
      });
    } catch (e) {
      throw new Error(
        `transpileFile threw on a non-safety sketch with no safety engine:\n${(e as Error).message}`,
      );
    }

    expect(result.sourcePath).toBeTruthy();
    expect(hasSafetyHook()).toBe(false);
  });
});
