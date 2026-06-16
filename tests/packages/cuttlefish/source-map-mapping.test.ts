// ---------------------------------------------------------------------------
// Tests for the multi-file compile-error -> TypeScript source mapping used by
// the native (g++) `--compile` path.
//
// Background: native mode compiles EVERY .cpp in the build dir, each with its
// own .thcppmap.json. The original implementation only loaded the entry file's
// map, so a g++ error originating in any other translation unit (e.g. an error
// in Forge.cpp while main.cpp is the entry) could never be mapped. These tests
// pin the per-file index + lookup that fixed that.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildSourceMapIndex,
  mapCppErrorToTs,
  mapCppLocationToTs,
  makeGeneratedMap,
  writeSourceMap,
} from "../../../packages/cuttlefish/src/mapping/source-map";
import type { GeneratedSourceMap } from "../../../packages/cuttlefish/src/types";

function tmpBuildDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cuttlefish-map-"));
}

/** A fake TS span pointing at the given file:line:col. */
function span(file: string, line: number, col: number) {
  return {
    filePath: file,
    startOffset: 0,
    endOffset: 10,
    startLine: line,
    startColumn: col,
    endLine: line,
    endColumn: col + 5,
  };
}

/** Write a generated .cpp stub + its .thcppmap.json covering one entry. */
function writeMap(
  dir: string,
  cppName: string,
  genStartLine: number,
  genEndLine: number,
  tsFile: string,
  tsLine: number,
  tsCol: number,
  nodeKind = "function_definition",
  symbolName?: string,
): { cppPath: string; map: GeneratedSourceMap } {
  const cppPath = path.join(dir, cppName);
  fs.writeFileSync(cppPath, "// generated\n");
  const map = makeGeneratedMap(cppPath, tsFile, [
    {
      generatedStartLine: genStartLine,
      generatedStartColumn: 1,
      generatedEndLine: genEndLine,
      generatedEndColumn: 40,
      tsSpan: span(tsFile, tsLine, tsCol),
      nodeKind,
      symbolName,
    },
  ]);
  writeSourceMap(map);
  return { cppPath, map };
}

describe("buildSourceMapIndex", () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpBuildDir();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("loads every .thcppmap.json in the dir, keyed by generated file path", () => {
    writeMap(dir, "main.cpp", 10, 12, "main.ts", 5, 1);
    writeMap(dir, "Forge.cpp", 20, 25, "Forge.ts", 30, 3);

    const index = buildSourceMapIndex(dir);

    expect(index.size).toBe(2);
    // Index keys are normalized (forward slashes, lowercase drive); mirror
    // that normalization in the lookup.
    const normKey = (() => {
      let p = path.resolve(path.join(dir, "main.cpp")).split(path.sep).join("/");
      if (/^[A-Za-z]:\//.test(p)) p = p[0].toLowerCase() + p.slice(1);
      return p;
    })();
    expect(index.get(normKey)?.sourceFilePath).toBe("main.ts");
  });

  it("returns an empty index when the dir has no maps", () => {
    fs.writeFileSync(path.join(dir, "main.cpp"), "// no map\n");
    const index = buildSourceMapIndex(dir);
    expect(index.size).toBe(0);
  });

  it("returns an empty index when the dir is missing", () => {
    const index = buildSourceMapIndex(path.join(dir, "does-not-exist"));
    expect(index.size).toBe(0);
  });

  it("skips malformed map files without aborting the index", () => {
    writeMap(dir, "main.cpp", 10, 12, "main.ts", 5, 1);
    fs.writeFileSync(path.join(dir, "broken.cpp.thcppmap.json"), "{ not json");
    const index = buildSourceMapIndex(dir);
    expect(index.size).toBe(1);
  });
});

describe("mapCppErrorToTs — cross-file mapping (the regression)", () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpBuildDir();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("maps an error in a NON-entry .cpp via that file's own map", () => {
    // main.cpp is the entry; Forge.cpp is a sibling translation unit.
    writeMap(dir, "main.cpp", 10, 12, "main.ts", 5, 1);
    const { cppPath: forgeCpp } = writeMap(dir, "Forge.cpp", 20, 25, "Forge.ts", 30, 3, "function_definition", "smelt");

    const index = buildSourceMapIndex(dir);

    // A g++ error at Forge.cpp:22 — this is the case that previously failed
    // because only main.cpp's map was loaded.
    const mapped = mapCppErrorToTs(index, {
      filePath: forgeCpp,
      line: 22,
      column: 5,
      message: "expected ';' after expression",
    });

    expect(mapped.mappedTsSpan).toBeDefined();
    expect(mapped.mappedTsSpan!.filePath).toBe("Forge.ts");
    expect(mapped.mappedTsSpan!.startLine).toBe(30);
    expect(mapped.symbolName).toBe("smelt");
  });

  it("maps an error in the entry .cpp via the entry map", () => {
    writeMap(dir, "main.cpp", 10, 12, "main.ts", 5, 1);
    writeMap(dir, "Forge.cpp", 20, 25, "Forge.ts", 30, 3);

    const index = buildSourceMapIndex(dir);
    const mapped = mapCppErrorToTs(index, {
      filePath: path.join(dir, "main.cpp"),
      line: 11,
      column: 2,
      message: "use of undeclared identifier 'x'",
    });

    expect(mapped.mappedTsSpan).toBeDefined();
    expect(mapped.mappedTsSpan!.filePath).toBe("main.ts");
  });

  it("normalizes drive-letter casing and separator differences from g++", () => {
    const { cppPath } = writeMap(dir, "main.cpp", 10, 12, "main.ts", 5, 1);
    const index = buildSourceMapIndex(dir);

    // g++ on Windows may report a path with uppercase drive + forward slashes
    // even when the emitter wrote a lowercase drive + backslashes (or vice versa).
    const altPath = cppPath.replace(/\\/g, "/");
    const altCased = /^[A-Za-z]:\//.test(altPath)
      ? altPath[0].toUpperCase() + altPath.slice(1)
      : altPath;

    const mapped = mapCppErrorToTs(index, {
      filePath: altCased,
      line: 11,
      column: 2,
      message: "err",
    });

    expect(mapped.mappedTsSpan).toBeDefined();
    expect(mapped.mappedTsSpan!.filePath).toBe("main.ts");
  });

  it("returns unmapped (undefined span) when no map covers the file", () => {
    writeMap(dir, "main.cpp", 10, 12, "main.ts", 5, 1);
    const index = buildSourceMapIndex(dir);

    // A generated runtime shim with no .thcppmap.json of its own.
    const mapped = mapCppErrorToTs(index, {
      filePath: path.join(dir, "polyfill.cpp"),
      line: 1,
      column: 1,
      message: "error",
    });

    expect(mapped.mappedTsSpan).toBeUndefined();
    expect(mapped.cppFilePath).toBe(path.join(dir, "polyfill.cpp"));
  });
});

describe("mapCppLocationToTs — single-map behavior unchanged", () => {
  it("still maps an in-range location to the closest entry", () => {
    const map = makeGeneratedMap("a.cpp", "a.ts", [
      {
        generatedStartLine: 10,
        generatedStartColumn: 1,
        generatedEndLine: 12,
        generatedEndColumn: 40,
        tsSpan: span("a.ts", 5, 1),
        nodeKind: "function_definition",
      },
    ]);
    const mapped = mapCppLocationToTs(map, 11, 5, "msg", "a.cpp");
    expect(mapped.mappedTsSpan?.startLine).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// printMappedCompileErrors — end-to-end output formatting.
// Verifies the rich mapped output (TS file:line:col + source line + caret) and
// the demoted C++ fallback for unmapped errors, against real temp-dir maps.
// ---------------------------------------------------------------------------
import { printMappedCompileErrors } from "../../../packages/cuttlefish/src/cli-utils";
import type { CompileResult } from "../../../packages/cuttlefish/src/api/shared";

describe("printMappedCompileErrors — output formatting", () => {
  let dir: string;
  let tsFile: string;
  let captured: string[];
  let errSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = tmpBuildDir();
    tsFile = path.join(dir, "Forge.ts");
    fs.writeFileSync(tsFile, "export class Forge {\n  constructor() {\n    this.x = 1;\n  }\n}\n");
    captured = [];
    errSpy = vi.spyOn(console, "error").mockImplementation((...args: any[]) => {
      captured.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
    });
    warnSpy = vi.spyOn(console, "warn").mockImplementation((...args: any[]) => {
      captured.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
    });
  });

  afterEach(() => {
    errSpy.mockRestore();
    warnSpy.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function compileResult(errors: CompileResult["errors"]): CompileResult {
    return {
      success: false,
      output: "",
      errors,
    } as CompileResult;
  }

  it("prints mapped errors in rich format referencing the TS source", () => {
    const { cppPath } = writeMap(dir, "Forge.cpp", 20, 25, tsFile, 3, 5, "constructor", "Forge");

    printMappedCompileErrors(
      compileResult([
        { filePath: cppPath, line: 22, column: 5, severity: "error", message: "expected ';' after expression" },
      ]),
      undefined,
      undefined,
      dir,
    );

    const out = captured.join("\n");
    // References the TS file (basename), not the C++ file's paren location.
    expect(out).toContain("Forge.ts");
    expect(out).not.toMatch(/Forge\.cpp\(/);
    // Rich format: position + source line + caret.
    expect(out).toContain("(3,5)");
    expect(out).toContain("this.x = 1;");
    expect(out).toContain("^");
    // The g++ message is carried through.
    expect(out).toContain("expected ';' after expression");
  });

  it("demotes unmapped errors as a gray C++ fallback", () => {
    writeMap(dir, "Forge.cpp", 20, 25, tsFile, 3, 5);

    // polyfill.cpp has no map -> unmapped.
    const unmappedCpp = path.join(dir, "polyfill.cpp");
    fs.writeFileSync(unmappedCpp, "// generated runtime shim\n");

    printMappedCompileErrors(
      compileResult([
        { filePath: unmappedCpp, line: 1, column: 1, severity: "error", message: "no matching function" },
      ]),
      undefined,
      undefined,
      dir,
    );

    const out = captured.join("\n");
    // Fallback header present.
    expect(out).toContain("Unmapped (generated-code)");
    // The raw C++ location is shown in the demoted block.
    expect(out).toContain("polyfill.cpp(1,1)");
    expect(out).toContain("no matching function");
    // No "Failed to map" wall of text (the old behavior).
    expect(out).not.toContain("Failed to map");
  });

  it("maps a mix: mapped TS errors first, then unmapped fallback", () => {
    const { cppPath } = writeMap(dir, "Forge.cpp", 20, 25, tsFile, 3, 5, "constructor", "Forge");
    const unmappedCpp = path.join(dir, "shim.cpp");
    fs.writeFileSync(unmappedCpp, "// generated\n");

    printMappedCompileErrors(
      compileResult([
        { filePath: cppPath, line: 22, column: 5, severity: "error", message: "TS-origin error" },
        { filePath: unmappedCpp, line: 9, column: 3, severity: "warning", message: "shim warning" },
      ]),
      undefined,
      undefined,
      dir,
    );

    const out = captured.join("\n");
    const tsIdx = out.indexOf("Forge.ts");
    const unmappedIdx = out.indexOf("Unmapped (generated-code)");
    // Mapped TS error appears before the unmapped fallback section.
    expect(tsIdx).toBeGreaterThan(-1);
    expect(unmappedIdx).toBeGreaterThan(-1);
    expect(tsIdx).toBeLessThan(unmappedIdx);
  });
});

