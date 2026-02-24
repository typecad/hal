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

import ts from "typescript";

/**
 * Flat map from dot-path key to scalar constant value.
 *
 * Examples (for Arduino Uno):
 *   "id"           → "arduino-uno"
 *   "mcu"          → "ATmega328P"
 *   "clockSpeed"   → 16000000
 *   "memory.flash" → 32768
 *   "memory.sram"  → 2048
 *   "memory.eeprom"→ 1024
 */
export type BoardConstants = Map<string, string | number | boolean>;

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
      ts.isIdentifier(keyNode) || ts.isStringLiteral(keyNode)
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
    }
    // Arrays and complex expressions are silently ignored.
  }
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
