// ---------------------------------------------------------------------------
// Config loader — reads and parses typecode.config.ts
//
// Walks up from a given directory to locate `typecode.config.ts`, then parses
// it with the TypeScript compiler API to extract the scalar config values.
// This mirrors the AST-based approach used by board-resolver.ts so we avoid
// any runtime evaluation (no ts-node / dynamic import needed).
// ---------------------------------------------------------------------------

import path from "node:path";
import fs from "node:fs";
import ts from "typescript";

/** The filename we search for when walking up directories. */
const CONFIG_FILENAME = "typecode.config.ts";

/**
 * Resolved configuration values extracted from `typecode.config.ts`.
 * Only the fields relevant to the transpiler are included — complex
 * nested objects (like `output`) are flattened into simple scalars.
 */
export interface ResolvedTypecodeConfig {
  /** Target architecture (e.g. 'avr', 'esp32', 'samd'). */
  target?: string;
  /** Board package specifier (e.g. '@typecode/board-arduino-uno'). */
  board?: string;
  /** Fully Qualified Board Name (e.g. 'arduino:avr:uno'). */
  fqbn?: string;
  /** Output framework (e.g. 'arduino', 'platformio'). */
  outputFramework?: string;
  /** Optimization level. */
  outputOptimize?: string;
  /** Output directory. */
  outputOutDir?: string;
  /** Architecture shim override. */
  architecture?: string;
  /** Path to the config file that was loaded. */
  configPath: string;
}

/**
 * Search upward from `startDir` for a file named `typecode.config.ts`.
 * Returns the absolute path on success, `undefined` if none is found.
 */
export function findConfigFile(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// AST helpers — extract scalar values from a TS object literal
// ---------------------------------------------------------------------------

function getStringLiteral(node: ts.Expression): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function getScalarValue(node: ts.Expression): string | number | boolean | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isNumericLiteral(node)) {
    return Number(node.text);
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

/**
 * Walk an object literal and collect all scalar (string / number / boolean)
 * property values into a flat dot-path map — exactly like board-resolver.ts.
 */
function walkObjectLiteral(
  obj: ts.ObjectLiteralExpression,
  prefix: string,
  out: Map<string, string | number | boolean>,
): void {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = ts.isIdentifier(prop.name)
      ? prop.name.text
      : ts.isStringLiteral(prop.name)
        ? prop.name.text
        : undefined;
    if (!key) continue;

    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (ts.isObjectLiteralExpression(prop.initializer)) {
      walkObjectLiteral(prop.initializer, fullKey, out);
    } else {
      const value = getScalarValue(prop.initializer);
      if (value !== undefined) {
        out.set(fullKey, value);
      }
    }
  }
}

/**
 * Parse `typecode.config.ts` and extract configuration values.
 *
 * The file must have a default export whose initializer is an object literal.
 * We find it by looking for:
 *   1. `export default <object>` — an ExportAssignment referencing a variable
 *   2. `const config: TypecodeConfig = { ... };` followed by `export default config;`
 *
 * Returns `undefined` if the file cannot be parsed or has no recognizable config.
 */
export function parseConfigFile(configPath: string): ResolvedTypecodeConfig | undefined {
  const sourceText = fs.readFileSync(configPath, "utf-8");
  const sourceFile = ts.createSourceFile(
    configPath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  // Collect all top-level variable declarations and the default export.
  const variableDecls = new Map<string, ts.VariableDeclaration>();
  let defaultExportName: string | undefined;
  let inlineDefaultObject: ts.ObjectLiteralExpression | undefined;

  for (const stmt of sourceFile.statements) {
    // Gather variable declarations: const config = { ... };
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          variableDecls.set(decl.name.text, decl);
        }
      }
    }

    // export default config;  (ExportAssignment with an identifier)
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      if (ts.isIdentifier(stmt.expression)) {
        defaultExportName = stmt.expression.text;
      } else if (ts.isObjectLiteralExpression(stmt.expression)) {
        inlineDefaultObject = stmt.expression;
      }
    }
  }

  // Resolve the config object literal.
  let configObject: ts.ObjectLiteralExpression | undefined = inlineDefaultObject;

  if (!configObject && defaultExportName) {
    const decl = variableDecls.get(defaultExportName);
    if (decl?.initializer && ts.isObjectLiteralExpression(decl.initializer)) {
      configObject = decl.initializer;
    }
  }

  if (!configObject) {
    return undefined;
  }

  // Walk the object literal into a flat map.
  const flat = new Map<string, string | number | boolean>();
  walkObjectLiteral(configObject, "", flat);

  // Map flat keys to the resolved config shape.
  const resolved: ResolvedTypecodeConfig = { configPath };

  const target = flat.get("target");
  if (typeof target === "string") resolved.target = target;

  const board = flat.get("board");
  if (typeof board === "string") resolved.board = board;

  const fqbn = flat.get("fqbn");
  if (typeof fqbn === "string") resolved.fqbn = fqbn;

  const architecture = flat.get("architecture");
  if (typeof architecture === "string") resolved.architecture = architecture;

  const outputFramework = flat.get("output.framework");
  if (typeof outputFramework === "string") resolved.outputFramework = outputFramework;

  const outputOptimize = flat.get("output.optimize");
  if (typeof outputOptimize === "string") resolved.outputOptimize = outputOptimize;

  const outputOutDir = flat.get("output.outDir");
  if (typeof outputOutDir === "string") resolved.outputOutDir = outputOutDir;

  return resolved;
}

/**
 * Generates (or updates) a `typecode-env.d.ts` file next to the config file.
 *
 * The file declares an ambient `@typecode` module that simply re-exports
 * everything from the concrete board package.  This lets the TypeScript
 * language server resolve `import { ... } from '@typecode'` in user files.
 *
 * The file is regenerated on every transpiler run so it stays in sync when
 * the board changes in `typecode.config.ts`.
 */
export function generateVirtualTypeDeclaration(config: ResolvedTypecodeConfig): void {
  if (!config.board) return;

  const configDir = path.dirname(config.configPath);
  const outPath = path.join(configDir, "typecode-env.d.ts");

  const content = [
    "// ---------------------------------------------------------------------------",
    "// typecode-env.d.ts — Virtual module declaration for '@typecode'",
    "//",
    "// Auto-generated by the typecode transpiler. Do not edit manually.",
    "// To change the board, update typecode.config.ts and re-run the transpiler.",
    "//",
    `// Board: ${config.board}`,
    "// ---------------------------------------------------------------------------",
    "",
    "declare module '@typecode' {",
    `  export * from '${config.board}';`,
    "}",
    "",
  ].join("\n");

  fs.writeFileSync(outPath, content, "utf-8");
}

/**
 * High-level entry point: find and load `typecode.config.ts` starting from
 * the given directory (typically the directory of the input .ts file).
 *
 * Returns `undefined` when no config file is found — the caller should
 * fall back to legacy behaviour (board determined by imports).
 */
export function loadTypecodeConfig(startDir: string): ResolvedTypecodeConfig | undefined {
  const configPath = findConfigFile(startDir);
  if (!configPath) return undefined;
  return parseConfigFile(configPath);
}
