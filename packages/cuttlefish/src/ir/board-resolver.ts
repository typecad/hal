// ---------------------------------------------------------------------------
// Board constant resolver
//
// Parses a TypeScript board-definition file (e.g. code/board-arduino-uno/index.ts)
// using the TypeScript compiler API and extracts all compile-time scalar values
// from the exported `BoardDefinition` object into a flat dot-path map.
//
// The result is stored in `ProgramIR.boardConstants` and used by the C++
// emitter to fold `Board.definition.*` property accesses into inline literals
// – without maintaining a separate hard-coded copy of the manifest.
// ---------------------------------------------------------------------------

import path from "node:path";
import fs from "node:fs";
import ts from "typescript";

import type { BoardConstants } from "../api/shared/index.js";

export type { BoardConstants };

/**
 * Returns a set of default board constants (standard Arduino Uno-like)
 * used as a fallback when no specific board manifest is loaded.
 */
export function getDefaultBoardConstants(): BoardConstants {
  const result: BoardConstants = new Map();
  result.set("pins.analogOffset", 14);
  result.set("peripherals.aliases.UART0", "Serial");
  result.set("peripherals.aliases.I2C0", "Wire");
  result.set("peripherals.aliases.SPI0", "SPI");
  return result;
}


/**
 * Parse a TypeScript board-definition source file and return a flat map of
 * all compile-time constant scalar values exported as a `BoardDefinition`.
 *
 * Properties whose values are arrays, spread elements, or other non-literal
 * expressions are silently skipped (no partial constant maps for board pins
 * etc. are needed by the emitter).
 *
 * @param defFilePath  Absolute path to the board definition `index.ts`.
 */
export function resolveBoardConstants(defFilePath: string): BoardConstants {
  const result: BoardConstants = new Map();

  // Build a minimal TypeScript program just to get a parsed AST with type
  // information for the target file.  We don't need emit or diagnostics.
  const program = ts.createProgram([defFilePath], {
    noEmit: true,
    skipLibCheck: true,
    strict: false,
    target: ts.ScriptTarget.ES2020,
  });

  // The source file may be keyed with either Windows or POSIX separators.
  const sourceFile =
    program.getSourceFile(defFilePath) ??
    program.getSourceFile(defFilePath.replace(/\\/g, "/"));

  if (!sourceFile) return result;

  // Same-file const table: module-local `const NAME = <literal>` declarations
  // (exported or not) that object literals reference by identifier — e.g. the
  // MCU packages' capability objects (FULL_GPIO, GPIO_ANALOG) and their YES/NO
  // boolean flags. The walker resolves those references through this table.
  const constTable = new Map<string, ts.Expression>();
  ts.forEachChild(sourceFile, (node) => {
    if (!ts.isVariableStatement(node)) return;
    for (const decl of node.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      let init: ts.Expression = decl.initializer;
      while (ts.isAsExpression(init)) init = init.expression;
      const isUsable =
        ts.isObjectLiteralExpression(init) ||
        init.kind === ts.SyntaxKind.TrueKeyword ||
        init.kind === ts.SyntaxKind.FalseKeyword ||
        ts.isNumericLiteral(init) ||
        ts.isStringLiteral(init) ||
        ts.isNoSubstitutionTemplateLiteral(init) ||
        (ts.isPrefixUnaryExpression(init) && ts.isNumericLiteral(init.operand));
      if (isUsable) constTable.set(decl.name.text, init);
    }
  });

  // Find exported variable declarations — both object literals (board/MCU defs)
  // and arrays of objects (peripheral instance lists).
  ts.forEachChild(sourceFile, (node) => {
    if (!ts.isVariableStatement(node)) return;

    const isExported = node.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (!isExported) return;

    for (const decl of node.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      const varName = decl.name.text;
      const init = decl.initializer;

      // Object literal — walk normally (board/MCU definitions)
      let walkInit: ts.Expression | undefined = init;
      // Unwrap `as const` / type assertions
      while (walkInit && ts.isAsExpression(walkInit)) walkInit = walkInit.expression;

      if (walkInit && ts.isObjectLiteralExpression(walkInit)) {
        // Peripheral capability objects (e.g. PWM_CAPABILITIES → peripherals.pwm.*)
        // are namespaced so HAL lookups like board("peripherals.pwm.resolution")
        // resolve. Other object literals (board/MCU definitions) walk with no prefix.
        if (varName.endsWith("_CAPABILITIES")) {
          const baseName = varName.replace("_CAPABILITIES", "").toLowerCase();
          walkObjectLiteral(walkInit, `peripherals.${baseName}`, result, constTable);
        } else {
          walkObjectLiteral(walkInit, "", result, constTable);
        }
      }

      // Array of objects — walk for peripheral instance data
      // (e.g., ADC_INSTANCES → peripherals.adc.0.*)
      if (walkInit && ts.isArrayLiteralExpression(walkInit)) {
        if (varName.endsWith("_INSTANCES")) {
          const baseName = varName.replace("_INSTANCES", "").toLowerCase();
          const prefix = `peripherals.${baseName}`;
          walkArrayLiteral(walkInit, prefix, result, constTable);
        }
      }
    }
  });

  // After parsing the board file, check for MCU imports and merge pin data.
  // Board definitions often use `...MCU.pins` spread which the AST walker
  // cannot handle, but the MCU file has static pin data we can parse.
  resolveAndMergeMCUConstants(defFilePath, result);

  // MCU-only resolution: the def file may itself be an MCU package definition
  // (a config with `mcu:` but no `board:` resolves pins straight from the
  // silicon). No board file sits above it, so nothing triggered the
  // peripherals.ts merge that board files get via mergeMCUConstants — do it
  // here. The mcu.ts/index.ts basename guard keeps the peripherals file
  // (also under an mcu- package) from merging itself recursively.
  const baseName = path.basename(defFilePath);
  const normalizedDef = defFilePath.replace(/\\/g, "/");
  if (
    (baseName === "mcu.ts" || baseName === "index.ts") &&
    /\/mcu-[^/]+\//.test(normalizedDef)
  ) {
    const periphFile = path.join(path.dirname(defFilePath), "peripherals.ts");
    if (fs.existsSync(periphFile)) {
      const periphConstants = resolveBoardConstants(periphFile);
      for (const [key, value] of periphConstants.entries()) {
        if (!result.has(key)) {
          result.set(key, value);
        }
      }
    }
  }

  return result;
}

/**
 * Detect MCU package imports in a board definition file, resolve the MCU
 * definition file, parse its pin/peripheral constants, and merge them into
 * the board constants. This handles the common pattern where board definitions
 * use spread operators (`...ATmega328P.pins`) that the AST walker can't parse.
 */
function resolveAndMergeMCUConstants(boardFilePath: string, boardConstants: BoardConstants): void {
  // Only proceed if the board file didn't produce pin.all entries on its own
  let hasPinData = false;
  for (const key of boardConstants.keys()) {
    if (key.startsWith("pins.all.")) { hasPinData = true; break; }
  }
  if (hasPinData) return;

  // Parse the board file to find MCU imports
  const sourceText = fs.readFileSync(boardFilePath, "utf-8");
  const sourceFile = ts.createSourceFile(boardFilePath, sourceText, ts.ScriptTarget.Latest, true);

  let mcuSpecifier: string | undefined;
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const spec = stmt.moduleSpecifier;
    if (!ts.isStringLiteral(spec)) continue;
    if (spec.text.startsWith("@typecad/mcu-")) {
      mcuSpecifier = spec.text;
      break;
    }
  }

  if (!mcuSpecifier) return;

  // Resolve the MCU package file path
  const parts = mcuSpecifier.split("/");
  const pkgName = parts[1]; // e.g. "mcu-atmega328p"
  const mcuFileNames = ["mcu.ts", "index.ts"];

  let dir = path.dirname(boardFilePath);
  while (true) {
    for (const mcuFileName of mcuFileNames) {
      const nmCandidate = path.join(dir, "node_modules", "@typecad", pkgName, "src", mcuFileName);
      if (fs.existsSync(nmCandidate)) {
        mergeMCUConstants(nmCandidate, boardConstants);
        return;
      }

      const pkgCandidate = path.join(dir, "packages", pkgName, "src", mcuFileName);
      if (fs.existsSync(pkgCandidate)) {
        mergeMCUConstants(pkgCandidate, boardConstants);
        return;
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

/**
 * Parse an MCU definition file and merge its pin data into the board constants.
 */
function mergeMCUConstants(mcuFilePath: string, boardConstants: BoardConstants): void {
  const mcuConstants = resolveBoardConstants(mcuFilePath);

  // Merge MCU pin data and peripheral constants into board constants.
  // Don't overwrite existing board-specific values
  for (const [key, value] of mcuConstants.entries()) {
    if (key.startsWith("pins.") || key.startsWith("peripherals.")) {
      if (!boardConstants.has(key)) {
        boardConstants.set(key, value);
      }
    }
  }

  // Copy architecture if the MCU has it and the board doesn't
  if (mcuConstants.has("architecture") && !boardConstants.has("architecture")) {
    boardConstants.set("architecture", mcuConstants.get("architecture")!);
  }

  // Also parse the MCU peripherals file for ADC/PWM/Timer data that the MCU
  // definition references via import (e.g., `peripherals: MCU_PERIPHERALS`).
  const mcuDir = path.dirname(mcuFilePath);
  const periphFile = path.join(mcuDir, "peripherals.ts");
  if (fs.existsSync(periphFile)) {
    const periphConstants = resolveBoardConstants(periphFile);
    for (const [key, value] of periphConstants.entries()) {
      if (!boardConstants.has(key)) {
        boardConstants.set(key, value);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively walk an `ObjectLiteralExpression`, adding scalar leaf values
 * to `out` keyed by their dot-separated path.
 *
 * @param obj     Current object literal to visit.
 * @param prefix  Dot-path accumulated so far (empty string at top level).
 * @param out     Accumulator map.
 */
function walkObjectLiteral(
  obj: ts.ObjectLiteralExpression,
  prefix: string,
  out: BoardConstants,
  constTable?: Map<string, ts.Expression>,
  resolving: Set<string> = new Set(),
): void {
  for (const prop of obj.properties) {
    // Spread of a same-file const object (e.g. `const GPIO_ANALOG = { ...FULL_GPIO,
    // analogInput: YES }`) — walk the referenced literal first so its keys land
    // at the same prefix; later explicit properties overwrite them.
    if (ts.isSpreadAssignment(prop)) {
      const target = prop.expression;
      if (constTable && ts.isIdentifier(target) && constTable.has(target.text) && !resolving.has(target.text)) {
        resolving.add(target.text);
        walkObjectLiteral(constTable.get(target.text) as ts.ObjectLiteralExpression, prefix, out, constTable, resolving);
        resolving.delete(target.text);
      }
      continue;
    }
    // Only handle plain  `key: value`  assignments.
    // Shorthand, methods, and getters are ignored.
    if (!ts.isPropertyAssignment(prop)) continue;

    const keyNode = prop.name;
    const key =
      ts.isIdentifier(keyNode) || ts.isStringLiteral(keyNode) || ts.isNumericLiteral(keyNode)
        ? keyNode.text
        : undefined;
    if (!key) continue;

    const fullPath = prefix ? `${prefix}.${key}` : key;
    let init = prop.initializer;

    // Same-file const reference as a property value (e.g. `capabilities:
    // GPIO_ANALOG`, or a scalar flag `pwm: YES`). Resolve through the const
    // table so MCU capability objects — declared once and referenced by every
    // pin — actually flatten into pins.all.N.capabilities.* keys. Without
    // this, pin-capability validation sees no capability data at all and
    // rejects interrupt/pwm/adc use on every pin of the board.
    if (constTable && ts.isIdentifier(init) && constTable.has(init.text) && !resolving.has(init.text)) {
      resolving.add(init.text);
      const resolved = constTable.get(init.text) as ts.Expression;
      const scalar = resolveScalar(resolved);
      if (scalar !== undefined) {
        out.set(fullPath, scalar);
      } else if (ts.isObjectLiteralExpression(resolved)) {
        walkObjectLiteral(resolved, fullPath, out, constTable, resolving);
      }
      resolving.delete(init.text);
      continue;
    }

    const scalar = resolveScalar(init);
    if (scalar !== undefined) {
      out.set(fullPath, scalar);
    } else if (ts.isObjectLiteralExpression(init)) {
      // Recurse into nested objects (e.g. `memory: { flash: 32_768, ... }`).
      walkObjectLiteral(init, fullPath, out, constTable, resolving);
    } else if (ts.isArrayLiteralExpression(init)) {
      // Capture string arrays (e.g. `pins.unsafe: ['D0', 'D1']`)
      const arrValues: string[] = [];
      for (const elem of init.elements) {
        if (ts.isStringLiteral(elem)) {
          arrValues.push(elem.text);
        }
      }
      if (arrValues.length > 0) {
        out.set(fullPath, arrValues.join(','));
      } else {
        walkArrayLiteral(init, fullPath, out, constTable, resolving);
      }
    }

    // Encode peripheral pin maps in a compact parseable format.
    // pins.i2c = { 0: { sda: 'A4', scl: 'A5' } } -> "0:sda=A4,scl=A5"
    // pins.spi = { 0: { mosi: 'D11', miso: 'D12', sck: 'D13', cs: 'D10' } } -> "0:mosi=D11,miso=D12,sck=D13,cs=D10"
    // pins.uart = { 0: { tx: 'D1', rx: 'D0' } } -> "0:tx=D1,rx=D0"
    if (ts.isObjectLiteralExpression(init)) {
      const encoded = tryEncodePeripheralPinMap(key, init);
      if (encoded) {
        out.set(fullPath, encoded);
      }
    }
    // Other complex expressions are silently ignored.
  }
}

function walkArrayLiteral(
  arr: ts.ArrayLiteralExpression,
  prefix: string,
  out: BoardConstants,
  constTable?: Map<string, ts.Expression>,
  resolving: Set<string> = new Set(),
): void {
  arr.elements.forEach((elem, index) => {
    const fullPath = `${prefix}.${index}`;
    const scalar = resolveScalar(elem as ts.Expression);
    if (scalar !== undefined) {
      out.set(fullPath, scalar);
      return;
    }

    if (ts.isObjectLiteralExpression(elem)) {
      walkObjectLiteral(elem, fullPath, out, constTable, resolving);
      return;
    }

    if (ts.isArrayLiteralExpression(elem)) {
      const arrValues: string[] = [];
      for (const nested of elem.elements) {
        if (ts.isStringLiteral(nested)) {
          arrValues.push(nested.text);
        }
      }
      if (arrValues.length > 0) {
        out.set(fullPath, arrValues.join(','));
      }
    }
  });
}

/**
 * Try to evaluate a simple literal expression to a scalar JS value.
 * Returns `undefined` for anything that is not a plain, directly readable
 * literal (string, number, boolean, negative-number).
 */
function resolveScalar(
  expr: ts.Expression,
): string | number | boolean | undefined {
  // Strip `as const` / `as T` type assertions — recurse on the inner expression.
  if (ts.isAsExpression(expr)) return resolveScalar(expr.expression);

  // String literal
  if (ts.isStringLiteral(expr)) return expr.text;

  // Numeric literal — TypeScript preserves underscore separators in `.text`
  // (e.g.  32_768), so we strip them before converting.
  if (ts.isNumericLiteral(expr)) {
    return Number(expr.text.replace(/_/g, ""));
  }

  // Boolean keywords
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return false;

  // Negative numeric literals:  -32768  or  -1_024
  if (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(expr.operand)
  ) {
    return -Number(expr.operand.text.replace(/_/g, ""));
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Peripheral pin map encoding
// ---------------------------------------------------------------------------

/**
 * Try to encode a peripheral pin map object into a compact string format.
 * Handles pins.i2c, pins.spi, pins.uart structures.
 *
 * Input:  { 0: { sda: 'A4', scl: 'A5' } }
 * Output: "0:sda=A4,scl=A5"
 *
 * Input:  { 0: { mosi: 'D11', miso: 'D12', sck: 'D13', cs: 'D10' } }
 * Output: "0:mosi=D11,miso=D12,sck=D13,cs=D10"
 */
function tryEncodePeripheralPinMap(
  key: string,
  obj: ts.ObjectLiteralExpression,
): string | undefined {
  // Only encode known peripheral pin structures
  if (key !== 'i2c' && key !== 'spi' && key !== 'uart') return undefined;

  const instances: string[] = [];

  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const keyNode = prop.name;
    if (!ts.isIdentifier(keyNode) && !ts.isStringLiteral(keyNode) && !ts.isNumericLiteral(keyNode)) continue;

    const instanceKey = keyNode.text;
    const value = prop.initializer;
    if (!ts.isObjectLiteralExpression(value)) continue;

    // Parse the inner object { sda: 'A4', scl: 'A5' } etc.
    const fields: string[] = [];
    for (const field of value.properties) {
      if (!ts.isPropertyAssignment(field)) continue;
      const fieldKey = field.name;
      if (!ts.isIdentifier(fieldKey) && !ts.isStringLiteral(fieldKey) && !ts.isNumericLiteral(fieldKey)) continue;
      const fieldValue = field.initializer;
      if (!ts.isStringLiteral(fieldValue)) continue;

      fields.push(`${fieldKey.text}=${fieldValue.text}`);
    }

    if (fields.length > 0) {
      instances.push(`${instanceKey}:${fields.join(',')}`);
    }
  }

  if (instances.length > 0) {
    return instances.join(';');
  }

  return undefined;
}

/**
 * Given a source file path and a relative import module specifier, check
 * whether the import resolves to a TypeCAD board-definition package
 * (path pattern: /code/board-*\/index.ts).
 *
 * Returns the absolute path to the board index.ts on match, otherwise
 * undefined.
 */
export function tryResolveBoardDefFile(
  fromFile: string,
  moduleSpecifier: string,
  boardPackage?: string,
): string | undefined {
  // Handle the "@typecad/board" virtual import — rewrite to the concrete board
  // package so the rest of the resolution logic works unchanged.
  // (Case-insensitive so the documented mixed-case form resolves identically.)
  let effectiveSpecifier = moduleSpecifier;
  if (moduleSpecifier.toLowerCase() === "@typecad/board" && boardPackage) {
    effectiveSpecifier = boardPackage;
  }

  // Handle relative imports (e.g. "../code/board-arduino-uno/pins")
  if (effectiveSpecifier.startsWith(".")) {
    const dir = path.dirname(fromFile);
    const base = path.resolve(dir, moduleSpecifier);

    // Candidates: bare path, +.ts, or /index.ts
    const candidates = [
      base,
      `${base}.ts`,
      path.join(base, "index.ts"),
    ];

    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue;
      const normalized = candidate.replace(/\\/g, "/");
      if (/[\\/]board-/.test(normalized)) {
        // Always redirect to index.ts in the board package root so we parse the
        // BoardDefinition manifest regardless of which file was actually imported
        // (e.g. board.ts, pins.ts, etc.).
        const boardDir = path.dirname(candidate);
        const indexTs = path.join(boardDir, "index.ts");
        return fs.existsSync(indexTs) ? indexTs : candidate;
      }
    }
    return undefined;
  }

  // Handle npm-scoped board package imports (e.g. "@typecad/board-esp32-devkit")
  if (effectiveSpecifier.startsWith("@typecad/board-")) {
    const parts = effectiveSpecifier.split("/");
    const pkgName = parts[1]; // "board-esp32-devkit"

    // Walk up from the importing file's directory to find node_modules OR a packages directory (monorepo)
    let dir = path.dirname(fromFile);
    while (true) {
      // 1. Try node_modules
      const nmCandidate = path.join(dir, "node_modules", "@typecad", pkgName, "src", "index.ts");
      if (fs.existsSync(nmCandidate)) return nmCandidate;

      // 2. Try packages/ directory (monorepo layout)
      const pkgCandidate = path.join(dir, "packages", pkgName, "src", "index.ts");
      if (fs.existsSync(pkgCandidate)) return pkgCandidate;

      // 3. Try sibling packages directory (if fromFile is inside a package)
      const siblingPkgCandidate = path.join(path.dirname(dir), "packages", pkgName, "src", "index.ts");
      if (fs.existsSync(siblingPkgCandidate)) return siblingPkgCandidate;

      const parent = path.dirname(dir);
      if (parent === dir) break; // reached filesystem root
      dir = parent;
    }
  }

  // Handle npm-scoped MCU package imports (e.g. "@typecad/mcu-esp32") — an
  // MCU-only config (no board package) resolves pin constants straight from
  // the silicon definition. MCU packages keep the definition object in either
  // src/mcu.ts (mcu-atmega328p style: index.ts is a pure barrel) or
  // src/index.ts (mcu-esp32 style: definition inline); prefer mcu.ts so the
  // walker always sees the object literal. The monorepo layouts alongside
  // node_modules are the top-level boards/ and mcus/ directories.
  if (effectiveSpecifier.startsWith("@typecad/mcu-")) {
    const parts = effectiveSpecifier.split("/");
    const pkgName = parts[1]; // "mcu-esp32"
    let dir = path.dirname(fromFile);
    while (true) {
      const srcDirs = [
        path.join(dir, "node_modules", "@typecad", pkgName, "src"),
        path.join(dir, "mcus", pkgName, "src"),
        path.join(dir, "packages", pkgName, "src"),
      ];
      for (const srcDir of srcDirs) {
        for (const fileName of ["mcu.ts", "index.ts"]) {
          const candidate = path.join(srcDir, fileName);
          if (fs.existsSync(candidate)) return candidate;
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return undefined;
  }

  return undefined;
}

/**
 * Resolve the framework-specific build target (e.g. Arduino FQBN) from the
 * board package's manifest.
 *
 * @param boardPackage  Board package identifier or path.
 * @param configPath    Path to the project config file (for relative resolution).
 * @param framework     Target framework name (default: 'arduino').
 */
export function resolveBoardBuildTarget(
  boardPackage: string,
  configPath: string,
  framework: string = "arduino"
): string | undefined {
  const defFile = tryResolveBoardDefFile(configPath, boardPackage);
  if (!defFile) return undefined;

  const constants = resolveBoardConstants(defFile);
  const target = constants.get(`build.frameworks.${framework}`);
  return typeof target === "string" ? target : undefined;
}
