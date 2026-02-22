import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { transpileFile } from "../src/transpile";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dirPath of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
});

describe("transpileFile module graph", () => {
  it("transpiles imported local modules", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typecode-"));
    tempDirs.push(workspaceDir);

    const entryPath = path.join(workspaceDir, "test.ts");
    const dependencyPath = path.join(workspaceDir, "test2.ts");

    fs.writeFileSync(
      entryPath,
      [
        'import { test2 } from "./test2";',
        "",
        "export function main(): number {",
        "  test2();",
        "  return 1;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    fs.writeFileSync(
      dependencyPath,
      [
        "export function test2(): void {",
        '  console.log("from test2");',
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = transpileFile({
      inputFile: entryPath,
      emitMode: "split",
      target: "generic",
      emitMaps: true,
      compileArduino: false,
    });

    const outDir = path.join(workspaceDir, ".build");
    const dependencyCppPath = path.join(outDir, "test2.cpp");
    const dependencyHeaderPath = path.join(outDir, "test2.h");
    const entryCppText = fs.readFileSync(result.sourcePath, "utf8");

    expect(result.sourcePath).toBe(path.join(outDir, "test.cpp"));
    expect(fs.existsSync(result.sourcePath)).toBe(true);
    expect(fs.existsSync(dependencyCppPath)).toBe(true);
    expect(fs.existsSync(dependencyHeaderPath)).toBe(true);
    expect(entryCppText).toContain('#include "test2.h"');
  });

  it("uses case-preserving local header include for relative imports", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typecode-"));
    tempDirs.push(workspaceDir);

    const entryPath = path.join(workspaceDir, "main.ts");
    const dependencyPath = path.join(workspaceDir, "myUtil.ts");

    fs.writeFileSync(
      entryPath,
      [
        'import { ping } from "./myUtil";',
        "",
        "export function main(): void {",
        "  ping();",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    fs.writeFileSync(
      dependencyPath,
      [
        "export function ping(): void {",
        "  return;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = transpileFile({
      inputFile: entryPath,
      emitMode: "split",
      target: "generic",
      emitMaps: true,
      compileArduino: false,
    });

    const entryCppText = fs.readFileSync(result.sourcePath, "utf8");

    expect(entryCppText).toContain('#include "myUtil.h"');
    expect(entryCppText).not.toContain("#include <Myutil.h>");
  });

  it("lowers function-expression aliases without raw or unmapped type warnings", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typecode-"));
    tempDirs.push(workspaceDir);

    const entryPath = path.join(workspaceDir, "test.ts");
    const dependencyPath = path.join(workspaceDir, "test2.ts");

    fs.writeFileSync(
      entryPath,
      [
        'import { test2 } from "./test2";',
        "type NumberArrayToNumber = (numberArray: number[]) => number;",
        "",
        "let sumAll: NumberArrayToNumber = function(numbers: number[]) {",
        "  let sum = 0;",
        "  for (let i=0; i < numbers.length; i++) {",
        "    sum += numbers[i];",
        "  }",
        "  return sum;",
        "};",
        "",
        "let computeAverage: NumberArrayToNumber = function(numbers: number[]) {",
        "  return sumAll(numbers)/numbers.length;",
        "};",
        "",
        "console.log(computeAverage([5, 10, 15]));",
        "main();",
        "function main(): number {",
        "  var _1 = 1;",
        "  test2();",
        "  return _1;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    fs.writeFileSync(
      dependencyPath,
      [
        "export function test2(): void {",
        '  console.log("from test2");',
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = transpileFile({
      inputFile: entryPath,
      emitMode: "cpp",
      target: "generic",
      emitMaps: true,
      compileArduino: false,
    });

    const warningCodes = result.diagnostics.map((diagnostic) => diagnostic.code);
    expect(warningCodes).not.toContain("TS2CPP_RAW_EXPR");
    expect(warningCodes).not.toContain("TS2CPP_UNMAPPED_TYPE");
  });

  it("maps string and boolean array aliases to std types", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typecode-"));
    tempDirs.push(workspaceDir);

    const entryPath = path.join(workspaceDir, "all-types.ts");

    fs.writeFileSync(
      entryPath,
      [
        "type StringList = string[];",
        "type BoolList = Array<boolean>;",
        "type Joiner = (items: StringList) => string;",
        "type AnyTrue = (items: BoolList) => boolean;",
        "",
        "let joinItems: Joiner = function(items: StringList) {",
        "  return items[0] + items[1];",
        "};",
        "",
        "let anyTrue: AnyTrue = function(items: BoolList) {",
        "  return items[0] || items[1];",
        "};",
        "",
        "console.log(joinItems([\"A\", \"B\"]));",
        "console.log(anyTrue([true, false]));",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = transpileFile({
      inputFile: entryPath,
      emitMode: "cpp",
      target: "generic",
      emitMaps: true,
      compileArduino: false,
    });

    const sourceText = fs.readFileSync(result.sourcePath, "utf8");
    expect(sourceText).toContain("#include <vector>");
    expect(sourceText).toContain("#include <functional>");
    expect(sourceText).toContain("#include <string>");
    expect(sourceText).toContain("using StringList = std::vector<std::string>;");
    expect(sourceText).toContain("using BoolList = std::vector<bool>;");
    expect(sourceText).toContain("using Joiner = std::function<std::string(std::vector<std::string>)>;");
    expect(sourceText).toContain("using AnyTrue = std::function<bool(std::vector<bool>)>;");

    const warningCodes = result.diagnostics.map((diagnostic) => diagnostic.code);
    expect(warningCodes).not.toContain("TS2CPP_UNMAPPED_TYPE");
    expect(warningCodes).not.toContain("TS2CPP_STRING_AUTO");
  });

  it("does not warn for generic structural alias object literals", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typecode-"));
    tempDirs.push(workspaceDir);

    const entryPath = path.join(workspaceDir, "collection.ts");

    fs.writeFileSync(
      entryPath,
      [
        "type Collection<G> = {",
        "  name: string,",
        "  quantity: number,",
        "  content: G[]",
        "};",
        "",
        "let bookCollection: Collection<string> = {",
        "  name: 'Nursery Books',",
        "  quantity: 3,",
        "  content: ['Goodnight Moon', 'Humpty Dumpty', 'Green Eggs & Ham']",
        "};",
        "",
        "let primeNumberCollection: Collection<number> = {",
        "  name: 'First 5 Prime Numbers',",
        "  quantity: 5,",
        "  content: [2, 3, 5, 7, 11]",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = transpileFile({
      inputFile: entryPath,
      emitMode: "cpp",
      target: "generic",
      emitMaps: true,
      compileArduino: false,
    });

    const warningCodes = result.diagnostics.map((diagnostic) => diagnostic.code);
    expect(warningCodes).not.toContain("TS2CPP_UNMAPPED_TYPE");
  });
});
