"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const vitest_1 = require("vitest");
const transpile_1 = require("../packages/cli/src/transpile");
const tempDirs = [];
(0, vitest_1.afterEach)(() => {
    for (const dirPath of tempDirs.splice(0, tempDirs.length)) {
        node_fs_1.default.rmSync(dirPath, { recursive: true, force: true });
    }
});
(0, vitest_1.describe)("transpileFile module graph", () => {
    (0, vitest_1.it)("transpiles imported local modules", () => {
        const workspaceDir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), "typecode-"));
        tempDirs.push(workspaceDir);
        const entryPath = node_path_1.default.join(workspaceDir, "test.ts");
        const dependencyPath = node_path_1.default.join(workspaceDir, "test2.ts");
        node_fs_1.default.writeFileSync(entryPath, [
            'import { test2 } from "./test2";',
            "",
            "export function main(): number {",
            "  test2();",
            "  return 1;",
            "}",
            "",
        ].join("\n"), "utf8");
        node_fs_1.default.writeFileSync(dependencyPath, [
            "export function test2(): void {",
            '  console.log("from test2");',
            "}",
            "",
        ].join("\n"), "utf8");
        const result = (0, transpile_1.transpileFile)({
            inputFile: entryPath,
            emitMode: "split",
            target: "generic",
            emitMaps: true,
        });
        const outDir = node_path_1.default.join(workspaceDir, ".build");
        const dependencyCppPath = node_path_1.default.join(outDir, "test2.cpp");
        const dependencyHeaderPath = node_path_1.default.join(outDir, "test2.h");
        const entryCppText = node_fs_1.default.readFileSync(result.sourcePath, "utf8");
        (0, vitest_1.expect)(result.sourcePath).toBe(node_path_1.default.join(outDir, "test.cpp"));
        (0, vitest_1.expect)(node_fs_1.default.existsSync(result.sourcePath)).toBe(true);
        (0, vitest_1.expect)(node_fs_1.default.existsSync(dependencyCppPath)).toBe(true);
        (0, vitest_1.expect)(node_fs_1.default.existsSync(dependencyHeaderPath)).toBe(true);
        (0, vitest_1.expect)(entryCppText).toContain('#include "test2.h"');
    });
    (0, vitest_1.it)("uses case-preserving local header include for relative imports", () => {
        const workspaceDir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), "typecode-"));
        tempDirs.push(workspaceDir);
        const entryPath = node_path_1.default.join(workspaceDir, "main.ts");
        const dependencyPath = node_path_1.default.join(workspaceDir, "myUtil.ts");
        node_fs_1.default.writeFileSync(entryPath, [
            'import { ping } from "./myUtil";',
            "",
            "export function main(): void {",
            "  ping();",
            "}",
            "",
        ].join("\n"), "utf8");
        node_fs_1.default.writeFileSync(dependencyPath, [
            "export function ping(): void {",
            "  return;",
            "}",
            "",
        ].join("\n"), "utf8");
        const result = (0, transpile_1.transpileFile)({
            inputFile: entryPath,
            emitMode: "split",
            target: "generic",
            emitMaps: true,
        });
        const entryCppText = node_fs_1.default.readFileSync(result.sourcePath, "utf8");
        (0, vitest_1.expect)(entryCppText).toContain('#include "myUtil.h"');
        (0, vitest_1.expect)(entryCppText).not.toContain("#include <Myutil.h>");
    });
    (0, vitest_1.it)("lowers function-expression aliases without raw or unmapped type warnings", () => {
        const workspaceDir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), "typecode-"));
        tempDirs.push(workspaceDir);
        const entryPath = node_path_1.default.join(workspaceDir, "test.ts");
        const dependencyPath = node_path_1.default.join(workspaceDir, "test2.ts");
        node_fs_1.default.writeFileSync(entryPath, [
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
        ].join("\n"), "utf8");
        node_fs_1.default.writeFileSync(dependencyPath, [
            "export function test2(): void {",
            '  console.log("from test2");',
            "}",
            "",
        ].join("\n"), "utf8");
        const result = (0, transpile_1.transpileFile)({
            inputFile: entryPath,
            emitMode: "cpp",
            target: "generic",
            emitMaps: true,
        });
        const warningCodes = result.diagnostics.map((diagnostic) => diagnostic.code);
        (0, vitest_1.expect)(warningCodes).not.toContain("TS2CPP_RAW_EXPR");
        (0, vitest_1.expect)(warningCodes).not.toContain("TS2CPP_UNMAPPED_TYPE");
    });
    (0, vitest_1.it)("maps string and boolean array aliases to std types", () => {
        const workspaceDir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), "typecode-"));
        tempDirs.push(workspaceDir);
        const entryPath = node_path_1.default.join(workspaceDir, "all-types.ts");
        node_fs_1.default.writeFileSync(entryPath, [
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
        ].join("\n"), "utf8");
        const result = (0, transpile_1.transpileFile)({
            inputFile: entryPath,
            emitMode: "cpp",
            target: "generic",
            emitMaps: true,
        });
        const sourceText = node_fs_1.default.readFileSync(result.sourcePath, "utf8");
        (0, vitest_1.expect)(sourceText).toContain("#include <vector>");
        (0, vitest_1.expect)(sourceText).toContain("#include <string>");
        // Function type aliases are transpiled as direct function declarations
        (0, vitest_1.expect)(sourceText).toContain("std::string joinItems(std::vector<std::string> items)");
        (0, vitest_1.expect)(sourceText).toContain("bool anyTrue(std::vector<bool> items)");
        const warningCodes = result.diagnostics.map((diagnostic) => diagnostic.code);
        (0, vitest_1.expect)(warningCodes).not.toContain("TS2CPP_UNMAPPED_TYPE");
        (0, vitest_1.expect)(warningCodes).not.toContain("TS2CPP_STRING_AUTO");
    });
    (0, vitest_1.it)("does not warn for generic structural alias object literals", () => {
        const workspaceDir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), "typecode-"));
        tempDirs.push(workspaceDir);
        const entryPath = node_path_1.default.join(workspaceDir, "collection.ts");
        node_fs_1.default.writeFileSync(entryPath, [
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
        ].join("\n"), "utf8");
        const result = (0, transpile_1.transpileFile)({
            inputFile: entryPath,
            emitMode: "cpp",
            target: "generic",
            emitMaps: true,
        });
        const warningCodes = result.diagnostics.map((diagnostic) => diagnostic.code);
        (0, vitest_1.expect)(warningCodes).not.toContain("TS2CPP_UNMAPPED_TYPE");
    });
});
