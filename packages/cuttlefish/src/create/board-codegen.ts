// ---------------------------------------------------------------------------
// board-codegen.ts — The orchestrator for `cuttlefish board add`.
// Validates the spec, calls the generators, writes files, edits the
// registry/tests/README (idempotently), and returns the file list + the
// framework-anticipation checklist.
//
// Pattern: mirrors init-scaffold.ts's scaffoldProject — a writeFile closure
// + fs.writeFileSync + tracks createdFiles.
// ---------------------------------------------------------------------------

import path from 'node:path';
import fs from 'node:fs';
import type { BoardSpec } from './board-spec.js';
import * as Gen from './board-generators.js';
import { generateFrameworkChecklist } from './board-checklist.js';

export interface ScaffoldBoardResult {
  createdFiles: string[];
  checklist: string;
}

/**
 * Find the monorepo root by walking up from startDir looking for a package.json
 * with a "workspaces" array containing "packages/cuttlefish".
 */
function findMonorepoRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 20; i++) {
    const pj = path.join(dir, 'package.json');
    if (fs.existsSync(pj)) {
      try {
        const content = JSON.parse(fs.readFileSync(pj, 'utf8'));
        if (Array.isArray(content.workspaces) && content.workspaces.some((w: string) => w.includes('packages/cuttlefish'))) {
          return dir;
        }
      } catch { /* keep walking */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not find monorepo root (no package.json with workspaces including packages/cuttlefish, starting from ${startDir}). Pass --rootDir explicitly.`);
}

/** Idempotently insert text into a file after a marker line, if not already present. */
function insertAfter(filePath: string, marker: string, insertion: string, searchForId: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, 'utf8');
  if (content.includes(searchForId)) return false; // already present
  const idx = content.indexOf(marker);
  if (idx === -1) return false;
  const insertPos = content.indexOf('\n', idx) + 1;
  const newContent = content.slice(0, insertPos) + insertion + content.slice(insertPos);
  fs.writeFileSync(filePath, newContent, 'utf8');
  return true;
}

export function scaffoldBoardPackages(
  spec: BoardSpec,
  opts: { force?: boolean; rootDir?: string } = {},
): ScaffoldBoardResult {
  const arch = spec.architecture;
  const rootDir = opts.rootDir ? path.resolve(opts.rootDir) : findMonorepoRoot(process.cwd());

  const mcuDir = path.join(rootDir, 'mcus', `mcu-${arch}`);
  const boardDir = path.join(rootDir, 'boards', `board-${arch}`);

  // Overwrite protection
  const mcuExists = fs.existsSync(mcuDir);
  const boardExists = fs.existsSync(boardDir);
  if ((mcuExists || boardExists) && !opts.force) {
    throw new Error(
      `Package directory already exists: ${mcuExists ? mcuDir : boardDir}\n` +
      `Use --force to overwrite (deletes and regenerates).`
    );
  }
  if (opts.force) {
    if (mcuExists) fs.rmSync(mcuDir, { recursive: true, force: true });
    if (boardExists) fs.rmSync(boardDir, { recursive: true, force: true });
  }

  const createdFiles: string[] = [];
  const writeFile = (filePath: string, content: string): void => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    createdFiles.push(filePath);
  };

  // --- MCU package ---
  writeFile(path.join(mcuDir, 'package.json'), Gen.genMcuPackageJson(spec));
  writeFile(path.join(mcuDir, 'tsconfig.json'), Gen.genMcuTsconfig(spec));
  writeFile(path.join(mcuDir, 'src', 'index.ts'), Gen.genMcuIndex(spec));
  writeFile(path.join(mcuDir, 'src', 'pins.ts'), Gen.genMcuPins(spec));
  writeFile(path.join(mcuDir, 'src', 'peripherals.ts'), Gen.genMcuPeripherals(spec));

  // --- Board package ---
  writeFile(path.join(boardDir, 'package.json'), Gen.genBoardPackageJson(spec));
  writeFile(path.join(boardDir, 'tsconfig.json'), Gen.genBoardTsconfig(spec));
  writeFile(path.join(boardDir, 'src', 'index.ts'), Gen.genBoardIndex(spec));
  writeFile(path.join(boardDir, 'src', 'pins.ts'), Gen.genBoardPins(spec));
  writeFile(path.join(boardDir, 'src', 'analog.ts'), Gen.genBoardAnalog(spec));
  writeFile(path.join(boardDir, 'src', 'board.ts'), Gen.genBoardNamespace(spec));

  // --- Idempotent edits to existing files (skipped if target doesn't exist) ---

  // 1. Root package.json workspaces
  const rootPjPath = path.join(rootDir, 'package.json');
  if (fs.existsSync(rootPjPath)) {
    try {
      const rootPj = JSON.parse(fs.readFileSync(rootPjPath, 'utf8'));
      if (Array.isArray(rootPj.workspaces) && !rootPj.workspaces.includes(`mcus/mcu-${arch}`)) {
        rootPj.workspaces.push(`mcus/mcu-${arch}`, `boards/board-${arch}`);
        fs.writeFileSync(rootPjPath, JSON.stringify(rootPj, null, 2) + '\n', 'utf8');
      }
    } catch { /* best-effort: skip if package.json isn't valid */ }
  }

  // 2. init-scaffold.ts registry entry
  const scaffoldPath = path.join(rootDir, 'packages', 'cuttlefish', 'src', 'create', 'init-scaffold.ts');
  const registryEntry = `  {\n    id: '${spec.boardId}',\n    displayName: '${spec.boardName}',\n    isNative: false,\n    architecture: '${arch}',\n    boardPackage: '@typecad/board-${arch}',\n    frameworkPackage: '@typecad/framework-arduino',\n    framework: 'arduino',\n    buildTarget: '${spec.fqbn}',\n    mcu: '${arch}',\n  },\n`;
  insertAfter(scaffoldPath, "  _knownTargets: KnownTarget[] = [", registryEntry, `'${spec.boardId}'`);

  // 3. KNOWN_BOARDS test
  const testPath = path.join(rootDir, 'tests', 'packages', 'transpiler', 'init-scaffold.test.ts');
  const testEntry = `
    it("contains ${spec.boardId}", () => {
      const b = KNOWN_BOARDS.find(b => b.id === '${spec.boardId}');
      expect(b).toBeDefined();
      expect(b!.architecture).toBe('${arch}');
      expect(b!.buildTarget).toBe('${spec.fqbn}');
    });
`;
  // Insert before the closing of the KNOWN_BOARDS describe block
  if (fs.existsSync(testPath)) {
    const content = fs.readFileSync(testPath, 'utf8');
    if (!content.includes(`'${spec.boardId}'`)) {
      // Find the end of the KNOWN_BOARDS describe block (the `});` after the last `it`)
      const describeStart = content.indexOf('describe("KNOWN_BOARDS"');
      if (describeStart !== -1) {
        // Find the closing `});` of this describe block
        let depth = 0;
        let endPos = -1;
        for (let i = describeStart; i < content.length; i++) {
          if (content[i] === '{') depth++;
          if (content[i] === '}') { depth--; if (depth === 0) { endPos = i; break; } }
        }
        if (endPos !== -1) {
          // Insert before the closing `});`
          const insertPos = content.lastIndexOf('\n', endPos);
          const newContent = content.slice(0, insertPos + 1) + testEntry + content.slice(insertPos + 1);
          fs.writeFileSync(testPath, newContent, 'utf8');
        }
      }
    }
  }

  // 4. Profile test file (new)
  const profileTestDir = path.join(rootDir, 'tests', 'packages', 'framework-arduino');
  const profileTestPath = path.join(profileTestDir, `${arch}-profile.test.ts`);
  const archUpper = arch.toUpperCase();
  const profileTestContent = `// ---------------------------------------------------------------------------
// Tests for ${spec.boardName} framework-arduino support
// (profile variant, capabilities, and IRAM_ATTR ISR attribute)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { ArduinoStrategy } from "../../../packages/framework-arduino/src";
import { resolveArduinoProfile } from "../../../packages/framework-arduino/src/profile";
import type { ProgramIR, PlatformContext } from "@typecad/cuttlefish/api/shared";

const CTX = { frameworkData: { buildTarget: "${spec.fqbn}" } } as PlatformContext;
const EMPTY_PROGRAM = { topLevelStatements: [], functions: [] } as any as ProgramIR;

describe("${spec.boardName} framework-arduino support", () => {
  describe("profile resolution", () => {
    it("forces <Arduino.h> include for the ${arch} FQBN", () => {
      const result = resolveArduinoProfile(EMPTY_PROGRAM, CTX);
      expect(result.forcedIncludes).toContain("<Arduino.h>");
      expect(result.diagnostics.filter(d => d.code === "TypeCAD_ARDUINO_FUNC_UNKNOWN")).toEqual([]);
    });

    it("does not emit an A0 shim for the ${arch} FQBN", () => {
      const program = {
        topLevelStatements: [
          { kind: "assign", target: "x", value: { kind: "identifier", value: "A0" } },
        ],
        functions: [],
      } as any as ProgramIR;
      const result = resolveArduinoProfile(program, CTX);
      expect(result.shimLines.filter(l => l.startsWith("#define A0"))).toEqual([]);
      expect(result.diagnostics.find(d => d.code === "TypeCAD_ARDUINO_SHIM_A0")).toBeUndefined();
    });
  });

  describe("ArduinoStrategy isrFunctionAttribute", () => {
    it("returns IRAM_ATTR for the ${arch} FQBN after profile resolution", () => {
      const strategy = new ArduinoStrategy();
      strategy.forcedIncludes(EMPTY_PROGRAM, CTX);
      expect(strategy.isrFunctionAttribute()).toBe("IRAM_ATTR ");
    });

    it("returns empty string for AVR", () => {
      const strategy = new ArduinoStrategy();
      const avrCtx = { frameworkData: { buildTarget: "arduino:avr:uno" } } as PlatformContext;
      strategy.forcedIncludes(EMPTY_PROGRAM, avrCtx);
      expect(strategy.isrFunctionAttribute()).toBe("");
    });
  });
});
`;
  if (!fs.existsSync(profileTestPath)) {
    writeFile(profileTestPath, profileTestContent);
  }

  // 5. README board table row + available-boards list
  const readmePath = path.join(rootDir, 'README.md');
  if (fs.existsSync(readmePath)) {
    let readme = fs.readFileSync(readmePath, 'utf8');
    // Board table: insert after the last `| ESP32-` row, before the blank line
    if (!readme.includes(`@typecad/board-${arch}`)) {
      const tableRow = `| ${spec.boardName} | \`@typecad/board-${arch}\` | ${spec.mcuName} |\n`;
      // Find the last board table row
      const tableMarker = '|---|---|---|';
      const tableIdx = readme.indexOf(tableMarker);
      if (tableIdx !== -1) {
        // Find the next blank line after the table
        const blankIdx = readme.indexOf('\n\n', tableIdx);
        if (blankIdx !== -1) {
          readme = readme.slice(0, blankIdx + 1) + tableRow + readme.slice(blankIdx + 1);
        }
      }
      // Available-boards list: append the id before the final period
      const listMarker = 'Available boards:';
      const listIdx = readme.indexOf(listMarker);
      if (listIdx !== -1) {
        const lineEnd = readme.indexOf('\n', listIdx);
        const line = readme.slice(listIdx, lineEnd);
        // Insert before the trailing backtick + period
        const updatedLine = line.replace(/(\`)\.$/, `, \`${spec.boardId}\`.`);
        readme = readme.slice(0, listIdx) + updatedLine + readme.slice(lineEnd);
      }
      fs.writeFileSync(readmePath, readme, 'utf8');
    }
  }

  return {
    createdFiles,
    checklist: generateFrameworkChecklist(spec),
  };
}
