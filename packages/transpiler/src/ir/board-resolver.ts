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

import type { BoardConstants } from "@typehal/core/shared";

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

  // Find the first exported variable declaration whose initializer is an
  // object literal — that is the board definition manifest.
  ts.forEachChild(sourceFile, (node) => {
    if (!ts.isVariableStatement(node)) return;

    const isExported = node.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (!isExported) return;

    for (const decl of node.declarationList.declarations) {
      const init = decl.initializer;
      if (!init || !ts.isObjectLiteralExpression(init)) continue;
      walkObjectLiteral(init, "", result);
      return; // stop after first match
    }
  });

  return result;
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
): void {
  for (const prop of obj.properties) {
    // Only handle plain  `key: value`  assignments.
    // Shorthand, spread, methods, and getters are ignored.
    if (!ts.isPropertyAssignment(prop)) continue;

    const keyNode = prop.name;
    const key =
      ts.isIdentifier(keyNode) || ts.isStringLiteral(keyNode) || ts.isNumericLiteral(keyNode)
        ? keyNode.text
        : undefined;
    if (!key) continue;

    const fullPath = prefix ? `${prefix}.${key}` : key;
    const init = prop.initializer;

    const scalar = resolveScalar(init);
    if (scalar !== undefined) {
      out.set(fullPath, scalar);
    } else if (ts.isObjectLiteralExpression(init)) {
      // Recurse into nested objects (e.g. `memory: { flash: 32_768, ... }`).
      walkObjectLiteral(init, fullPath, out);
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
        walkArrayLiteral(init, fullPath, out);
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
): void {
  arr.elements.forEach((elem, index) => {
    const fullPath = `${prefix}.${index}`;
    const scalar = resolveScalar(elem as ts.Expression);
    if (scalar !== undefined) {
      out.set(fullPath, scalar);
      return;
    }

    if (ts.isObjectLiteralExpression(elem)) {
      walkObjectLiteral(elem, fullPath, out);
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
 * whether the import resolves to a typehal board-definition package
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
  // Handle bare "@typehal" virtual import — rewrite to the concrete board
  // package so the rest of the resolution logic works unchanged.
  let effectiveSpecifier = moduleSpecifier;
  if (moduleSpecifier === "@typehal" && boardPackage) {
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

  // Handle npm-scoped board package imports (e.g. "@typehal/board-esp32-devkit")
  if (effectiveSpecifier.startsWith("@typehal/board-")) {
    const parts = effectiveSpecifier.split("/");
    const pkgName = parts[1]; // "board-esp32-devkit"

    // Walk up from the importing file's directory to find node_modules OR a packages directory (monorepo)
    let dir = path.dirname(fromFile);
    while (true) {
      // 1. Try node_modules
      const nmCandidate = path.join(dir, "node_modules", "@typehal", pkgName, "src", "index.ts");
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
