// ---------------------------------------------------------------------------
// `typecad-hal gen-decls` argument parsing.
//
// Symptom (reported): every form that uses `--all` fails:
//
//   $ typecad-hal gen-decls --all ./lib
//   ✗ Missing input file path.
//   $ typecad-hal gen-decls --all ./lib/Adafruit_GFX_Library/Adafruit_GFX.cpp
//   ✗ Missing input file path.
//
// Root cause: in parseCommandLine the positional path for gen-decls was read
// from a hardcoded `argv[3]`. When `--all` precedes the path, the path lives
// at argv[4] and argv[3] is the literal "--all" — so scanDir resolved to a
// bogus path like `<cwd>\--all`, and downstream code that gated on
// `options.inputFile` (intentionally undefined for --all mode) threw before
// the gen-decls branch could run.
//
// Fix: scan argv for the first non-flag token after the subcommand name,
// instead of assuming the positional always sits at index 3; and move the
// gen-decls branch ahead of the `!options.inputFile` guard in cli.ts.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { parseCommandLine, generateDecl } from "@typecad/cuttlefish/testing";

describe("gen-decls argument parsing", () => {
  it("single .cpp file mode sets inputFile", () => {
    const result: any = parseCommandLine([
      "node", "typecad-hal", "gen-decls", "Adafruit_GFX.cpp",
    ]);
    expect(result.command).toBe("gen-decls");
    expect(result.inputFile).toBe(path.resolve(process.cwd(), "Adafruit_GFX.cpp"));
    expect(result.scanDir).toBeUndefined();
  });

  it("--all <directory> sets scanDir, not inputFile", () => {
    const result: any = parseCommandLine([
      "node", "typecad-hal", "gen-decls", "--all", "./lib",
    ]);
    expect(result.command).toBe("gen-decls");
    expect(result.scanDir).toBe(path.resolve(process.cwd(), "./lib"));
    expect(result.inputFile).toBeUndefined();
  });

  it("--all <directory> works when --all is placed AFTER the directory", () => {
    // Equivalent reordering: positional may appear before the flag too.
    const result: any = parseCommandLine([
      "node", "typecad-hal", "gen-decls", "./lib", "--all",
    ]);
    expect(result.command).toBe("gen-decls");
    expect(result.scanDir).toBe(path.resolve(process.cwd(), "./lib"));
    expect(result.inputFile).toBeUndefined();
  });

  it("--all with a .cpp path resolves scanDir to that path (not to literal '--all')", () => {
    // Regression for the reported bug: argv[3] was "--all", argv[4] was the
    // path. The old code read argv[3] and produced scanDir = "<cwd>/--all".
    const result: any = parseCommandLine([
      "node", "typecad-hal", "gen-decls", "--all",
      "./lib/Adafruit_GFX_Library/Adafruit_GFX.cpp",
    ]);
    expect(result.command).toBe("gen-decls");
    expect(result.scanDir).toBe(
      path.resolve(process.cwd(), "./lib/Adafruit_GFX_Library/Adafruit_GFX.cpp"),
    );
    // CRITICAL: must NOT contain the literal "--all" as a path component.
    expect(result.scanDir).not.toContain("--all");
  });

  it("--all with no path falls back to cwd", () => {
    const result: any = parseCommandLine([
      "node", "typecad-hal", "gen-decls", "--all",
    ]);
    expect(result.command).toBe("gen-decls");
    expect(result.scanDir).toBe(process.cwd());
  });

  it("rejects single-file mode with no path and no --all", () => {
    expect(() =>
      parseCommandLine(["node", "typecad-hal", "gen-decls"]),
    ).toThrow(/Missing input C\+\+ file path/);
  });
});

describe("gen-decls single-file .h runtime acceptance", () => {
  it("generateDecl accepts a .h file and produces a .d.ts", () => {
    const tmp = path.join(os.tmpdir(), `gen-decls-cli-${Date.now()}.h`);
    fs.writeFileSync(tmp, "class Foo { public: void bar(); };", "utf8");
    try {
      const out = generateDecl(tmp);
      expect(out).toBeTruthy();
      expect(path.basename(out!)).toBe(path.basename(tmp, ".h") + ".d.ts");
      expect(fs.readFileSync(out!, "utf8")).toContain("export declare class Foo");
    } finally {
      fs.rmSync(tmp, { force: true });
      fs.rmSync(tmp.replace(/\.h$/, ".d.ts"), { force: true });
    }
  });
});
