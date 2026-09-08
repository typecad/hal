// ---------------------------------------------------------------------------
// board-gate.ts — the engine's reader for hal's board-gate export lists.
//
// Board generators (the contract board-generator, framework boardgen) emit
// `export { ... } from '@typecad/hal/core'` lines into generated board
// modules and need the exact ungated surface as strings. The engine no
// longer depends on @typecad/hal as a package — it reads the classification
// from the SAME resolved hal source tree the HAL parser uses
// (resolveHALSourceDir), so the project's own hal copy is the source of
// truth for both:
//
//   - gate.ts's GATED_EXPORTS + BOARD_UNGATED_TYPE_EXPORTS (the declared
//     classification), and
//   - index.ts's export statements (the runtime surface), from which the
//     ungated value list is DERIVED: value exports minus the gated set
//     minus the gate metadata names themselves.
//
// A new value export in hal's index therefore classifies itself as ungated
// with no list edits. Results are cached per resolved source dir.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { parseSource } from "./ast/parse.js";
import { resolveHALSourceDir } from "./ir/hal-resolver.js";

export interface BoardGateData {
  /** Hal value exports re-exported unconditionally by generated board modules. */
  readonly ungated: readonly string[];
  /** Hal type-only exports re-exported unconditionally. */
  readonly ungatedTypes: readonly string[];
  /** Hal value exports gated on board facts (the declared classification). */
  readonly gated: readonly string[];
}

/** Names gate.ts itself exports through index.ts — never part of the surface. */
const GATE_METADATA_EXPORTS = new Set(["GATED_EXPORTS", "BOARD_UNGATED_TYPE_EXPORTS"]);

const cache = new Map<string, BoardGateData>();

/** Read a `const x: readonly string[] = [ ... ]` literal from a source file. */
function readStringArray(sourceFile: ts.SourceFile, variableName: string): readonly string[] {
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === variableName && decl.initializer && ts.isArrayLiteralExpression(decl.initializer)) {
        return decl.initializer.elements
          .filter((el): el is ts.StringLiteral => ts.isStringLiteral(el))
          .map((el) => el.text);
      }
    }
  }
  throw new Error(`@typecad/hal gate.ts does not declare '${variableName}' — unsupported hal shape`);
}

/** Value-export names from an index.ts-shaped barrel (type-only exports skipped). */
function readIndexValueExports(sourceFile: ts.SourceFile): readonly string[] {
  const names: string[] = [];
  for (const stmt of sourceFile.statements) {
    if (!ts.isExportDeclaration(stmt) || !stmt.exportClause || !ts.isNamedExports(stmt.exportClause)) continue;
    for (const spec of stmt.exportClause.elements) {
      // Type-only can be marked on the whole declaration (`export type { X }`)
      // or on the individual specifier (`export { type X, y }`).
      if (stmt.isTypeOnly || spec.isTypeOnly) continue;
      names.push(spec.name.text);
    }
  }
  return names;
}

/**
 * The board-gate export lists, derived from the resolved @typecad/hal source
 * tree. `preferredDir` (a project dir) anchors resolution when the ambient
 * transpile context is not set — board generators that know their project
 * pass it explicitly.
 */
export function getBoardGateData(preferredDir?: string): BoardGateData {
  const srcDir = resolveHALSourceDir(preferredDir);
  const cached = cache.get(srcDir);
  if (cached) return cached;

  const gateFile = path.join(srcDir, "gate.ts");
  const indexFile = path.join(srcDir, "index.ts");
  if (!fs.existsSync(gateFile) || !fs.existsSync(indexFile)) {
    throw new Error(
      `Resolved @typecad/hal/src at ${srcDir} has no gate.ts/index.ts — unsupported hal layout`,
    );
  }

  const gateSource = parseSource("gate.ts", fs.readFileSync(gateFile, "utf-8"));
  const gated = readStringArray(gateSource, "GATED_EXPORTS");
  const ungatedTypes = readStringArray(gateSource, "BOARD_UNGATED_TYPE_EXPORTS");

  const indexSource = parseSource("index.ts", fs.readFileSync(indexFile, "utf-8"));
  const gatedSet = new Set(gated);
  const ungated = readIndexValueExports(indexSource).filter(
    (name) => !gatedSet.has(name) && !GATE_METADATA_EXPORTS.has(name),
  );

  const data: BoardGateData = { ungated, ungatedTypes, gated };
  cache.set(srcDir, data);
  return data;
}

/** Test seam — drop the per-dir cache. */
export function __resetBoardGateCache(): void {
  cache.clear();
}
