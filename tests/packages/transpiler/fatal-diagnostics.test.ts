import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { transpileFile } from "@typecad/cuttlefish/testing";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dirPath of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
});

describe("fatal transpiler diagnostics", () => {
  it("aborts transpilation before emission for unsupported prescan features", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "cuttlefish-fatal-"));
    tempDirs.push(workspaceDir);

    const entryPath = path.join(workspaceDir, "main.ts");
    fs.writeFileSync(
      entryPath,
      [
        "const base = { a: 1 };",
        "const merged = { ...base, b: 2 };",
        "console.log(merged.b);",
        "",
      ].join("\n"),
      "utf8",
    );

    await expect(transpileFile({
      inputFile: entryPath,
      emitMode: "cpp",
      target: "generic",
      emitMaps: true,
      skipTypeCheck: true,
    })).rejects.toThrow(/TS2CPP_NO_EQUIVALENT|Object spread/);
  });
});
