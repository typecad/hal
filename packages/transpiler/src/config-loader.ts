// ---------------------------------------------------------------------------
// Config loader — reads and parses typehal.config.ts
//
// Walks up from a given directory to locate `typehal.config.ts`, then parses
// it with the TypeScript compiler API to extract the scalar config values.
// This mirrors the AST-based approach used by board-resolver.ts so we avoid
// any runtime evaluation (no ts-node / dynamic import needed).
// ---------------------------------------------------------------------------

import path from "node:path";
import fs from "node:fs";
import ts from "typescript";
import { safeValidateConfig } from "./config-schema";

/** The filename we search for when walking up directories. */
const CONFIG_FILENAME = "typehal.config.ts";

/**
 * Resolved configuration values extracted from `typehal.config.ts`.
 * Only the fields relevant to the transpiler are included — complex
 * nested objects (like `output`) are flattened into simple scalars.
 */
export interface ResolvedTypehalConfig {
  target?: string;
  /** MCU package specifier (e.g. '@typehal/mcu-atmega328p'). */
  mcu?: string;
  /** Board package specifier (e.g. '@typehal/board-arduino-uno'). (Deprecated) */
  board?: string;
  /** Path to a TypeCAD contract file (*.contract.json). */
  contract?: string;
  /** Build target identifier (e.g. FQBN for Arduino CLI). */
  buildTarget?: string;
  /** Output framework (e.g. 'arduino', 'platformio'). */
  outputFramework?: string;
  /** Optimization level. */
  outputOptimize?: string;
  /** Output directory. */
  outputOutDir?: string;
  /**
   * Framework package for code generation strategy.
   * Can be '@typehal/framework-arduino', '@typehal/framework-avr', or a custom path.
   */
  framework?: string;
  /** Entry point TypeScript file (relative to config file directory). */
  entry?: string;
  /** Path to the config file that was loaded. */
  configPath: string;
  /** Console polyfill configuration. */
  console?: {
    baudRate?: number;
  };
  /** Extra compiler flags from `output.extraFlags`. */
  outputExtraFlags?: string[];
  /** Additional defines from `output.defines`. */
  outputDefines?: Record<string, string>;
  /** Framework-specific config (e.g. `native` section). */
  frameworkConfig?: Record<string, unknown>;
}

/**
 * Search upward from `startDir` for a file named `typehal.config.ts`.
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

function unwrapTypeCast(node: ts.Expression): ts.Expression {
  let curr = node;
  while (ts.isAsExpression(curr) || ts.isTypeAssertionExpression(curr)) {
    curr = curr.expression;
  }
  return curr;
}

function getStringLiteral(node: ts.Expression): string | undefined {
  const unwrapped = unwrapTypeCast(node);
  if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
    return unwrapped.text;
  }
  return undefined;
}

function getScalarValue(node: ts.Expression): string | number | boolean | undefined {
  const unwrapped = unwrapTypeCast(node);
  if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
    return unwrapped.text;
  }
  if (ts.isNumericLiteral(unwrapped)) {
    return Number(unwrapped.text);
  }
  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) return false;
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

// ---------------------------------------------------------------------------
// Structured field extraction (arrays, records, framework sections)
// ---------------------------------------------------------------------------

/**
 * Navigate into a nested object literal by following property names.
 * Returns the final property's initializer expression, or undefined.
 */
function navigateToObjectProperty(
  obj: ts.ObjectLiteralExpression,
  path: string[],
): ts.Expression | undefined {
  let current: ts.ObjectLiteralExpression = obj;
  for (let i = 0; i < path.length; i++) {
    const segment = path[i];
    let found = false;
    for (const prop of current.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const key = ts.isIdentifier(prop.name)
        ? prop.name.text
        : ts.isStringLiteral(prop.name)
          ? prop.name.text
          : undefined;
      if (key !== segment) continue;
      if (i === path.length - 1) return prop.initializer;
      if (ts.isObjectLiteralExpression(prop.initializer)) {
        current = prop.initializer;
        found = true;
        break;
      }
      return undefined;
    }
    if (!found) return undefined;
  }
  return undefined;
}

function extractStringArray(
  obj: ts.ObjectLiteralExpression,
  path: string[],
): string[] | undefined {
  const leaf = navigateToObjectProperty(obj, path);
  if (!leaf || !ts.isArrayLiteralExpression(leaf)) return undefined;
  const result: string[] = [];
  for (const elem of leaf.elements) {
    const s = getStringLiteral(elem);
    if (s === undefined) return undefined;
    result.push(s);
  }
  return result;
}

function extractStringRecord(
  obj: ts.ObjectLiteralExpression,
  path: string[],
): Record<string, string> | undefined {
  const leaf = navigateToObjectProperty(obj, path);
  if (!leaf || !ts.isObjectLiteralExpression(leaf)) return undefined;
  const result: Record<string, string> = {};
  for (const prop of leaf.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = ts.isIdentifier(prop.name)
      ? prop.name.text
      : ts.isStringLiteral(prop.name)
        ? prop.name.text
        : undefined;
    if (!key) continue;
    const value = getStringLiteral(prop.initializer);
    if (value === undefined) return undefined;
    result[key] = value;
  }
  if (Object.keys(result).length === 0) return undefined;
  return result;
}

/**
 * Recursively extract an object literal as Record<string, unknown>.
 * Handles strings, numbers, booleans, string arrays, and nested objects.
 */
function extractObjectAsRecord(obj: ts.ObjectLiteralExpression): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = ts.isIdentifier(prop.name)
      ? prop.name.text
      : ts.isStringLiteral(prop.name)
        ? prop.name.text
        : undefined;
    if (!key) continue;
    const init = prop.initializer;
    if (ts.isObjectLiteralExpression(init)) {
      result[key] = extractObjectAsRecord(init);
    } else if (ts.isArrayLiteralExpression(init)) {
      const arr = extractStringArrayFromArrayLiteral(init);
      if (arr) result[key] = arr;
    } else {
      const scalar = getScalarValue(init);
      if (scalar !== undefined) result[key] = scalar;
    }
  }
  return result;
}

function extractStringArrayFromArrayLiteral(node: ts.ArrayLiteralExpression): string[] | undefined {
  const result: string[] = [];
  for (const elem of node.elements) {
    const s = getStringLiteral(elem);
    if (s === undefined) return undefined;
    result.push(s);
  }
  return result;
}

/**
 * Extract a top-level config section as a generic Record<string, unknown>.
 */
function extractFrameworkSection(
  obj: ts.ObjectLiteralExpression,
  sectionName: string,
): Record<string, unknown> | undefined {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = ts.isIdentifier(prop.name)
      ? prop.name.text
      : ts.isStringLiteral(prop.name)
        ? prop.name.text
        : undefined;
    if (key !== sectionName) continue;
    if (!ts.isObjectLiteralExpression(prop.initializer)) return undefined;
    return extractObjectAsRecord(prop.initializer);
  }
  return undefined;
}

/**
 *
 * The file must have a default export whose initializer is an object literal.
 * We find it by looking for:
 *   1. `export default <object>` — an ExportAssignment referencing a variable
 *   2. `const config: TypehalConfig = { ... };` followed by `export default config;`
 *
 * Returns `undefined` if the file cannot be parsed or has no recognizable config.
 */
export function parseConfigFile(configPath: string): ResolvedTypehalConfig | undefined {
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
  const resolved: ResolvedTypehalConfig = { configPath };

  const entry = flat.get("entry");
  if (typeof entry === "string") resolved.entry = entry;

  const target = flat.get("target");
  if (typeof target === "string") resolved.target = target;

  const mcu = flat.get("mcu");
  if (typeof mcu === "string") resolved.mcu = mcu;

  const board = flat.get("board");
  if (typeof board === "string") resolved.board = board;

  const contract = flat.get("contract");
  if (typeof contract === "string") resolved.contract = contract;

  // We do not extract fqbn here anymore, it should be in frameworkData
  const buildTarget = flat.get("frameworkData.buildTarget");
  if (typeof buildTarget === "string") resolved.buildTarget = buildTarget;

  const framework = flat.get("framework");
  if (typeof framework === "string") resolved.framework = framework;

  const outputFramework = flat.get("output.framework");
  if (typeof outputFramework === "string") resolved.outputFramework = outputFramework;

  const outputOptimize = flat.get("output.optimize");
  if (typeof outputOptimize === "string") resolved.outputOptimize = outputOptimize;

  const outputOutDir = flat.get("output.outDir");
  if (typeof outputOutDir === "string") resolved.outputOutDir = outputOutDir;

  // Parse console configuration
  const consoleBaudRate = flat.get("console.baudRate");
  if (typeof consoleBaudRate === "number") {
    resolved.console = { baudRate: consoleBaudRate };
  }

  // Extract structured fields that the flat walker cannot handle.
  const outputExtraFlags = extractStringArray(configObject, ["output", "extraFlags"]);
  if (outputExtraFlags) resolved.outputExtraFlags = outputExtraFlags;

  const outputDefines = extractStringRecord(configObject, ["output", "defines"]);
  if (outputDefines) resolved.outputDefines = outputDefines;

  const nativeSection = extractFrameworkSection(configObject, "native");
  if (nativeSection) resolved.frameworkConfig = nativeSection;

  // Validate the parsed config against the Zod schema.
  // Reconstruct a structured object from the flat-map extraction for validation.
  const structuredForValidation: Record<string, unknown> = {};
  if (resolved.target) structuredForValidation.target = resolved.target;
  if (resolved.mcu) structuredForValidation.mcu = resolved.mcu;
  if (resolved.board) structuredForValidation.board = resolved.board;
  if (resolved.contract) structuredForValidation.contract = resolved.contract;
  if (resolved.entry) structuredForValidation.entry = resolved.entry;
  if (resolved.framework) structuredForValidation.framework = resolved.framework;
  if (resolved.outputFramework || resolved.outputOptimize || resolved.outputOutDir || resolved.outputExtraFlags || resolved.outputDefines) {
    structuredForValidation.output = {
      ...(resolved.outputFramework ? { framework: resolved.outputFramework } : {}),
      ...(resolved.outputOptimize ? { optimize: resolved.outputOptimize } : {}),
      ...(resolved.outputOutDir ? { outDir: resolved.outputOutDir } : {}),
      ...(resolved.outputExtraFlags ? { extraFlags: resolved.outputExtraFlags } : {}),
      ...(resolved.outputDefines ? { defines: resolved.outputDefines } : {}),
    };
  }
  if (resolved.console) structuredForValidation.console = resolved.console;
  if (resolved.buildTarget) {
    structuredForValidation.frameworkData = { buildTarget: resolved.buildTarget };
  }

  const validation = safeValidateConfig(structuredForValidation);
  if (!validation.success) {
    const errorMsg = validation.errors.map(e => `  - ${e}`).join("\n");
    throw new Error(`Configuration validation failed for ${configPath}:\n${errorMsg}`);
  }

  return resolved;
}

/**
 * Generates (or updates) a `typehal-env.d.ts` file next to the config file.
 *
 * The file declares an ambient `@typehal` module that simply re-exports
 * everything from the concrete board package.  This lets the TypeScript
 * language server resolve `import { ... } from '@typehal'` in user files.
 *
 * The file is regenerated on every transpiler run so it stays in sync when
 * the board changes in `typehal.config.ts`.
 */
export function generateVirtualTypeDeclaration(config: ResolvedTypehalConfig, platformDeclarations?: string[]): void {
  if (!config.mcu && !config.board) return;

  const configDir = path.dirname(config.configPath);
  const outPath = path.join(configDir, "typehal-env.d.ts");

  // Determine what @typehal exports
  let typehalExport = "";
  if (config.contract) {
    // Contract-based: export from generated board
    typehalExport = "export * from './.typehal/board';";
  } else if (config.board) {
    // Explicit board package (legacy)
    typehalExport = `export * from '${config.board}';`;
  } else {
    // MCU-only: export all from MCU
    typehalExport = `export * from '${config.mcu}';`;
  }

  const content = [
    "// ---------------------------------------------------------------------------",
    "// typehal-env.d.ts — Virtual module declaration for '@typehal'",
    "//",
    "// Auto-generated by the typehal transpiler. Do not edit manually.",
    "// To change the board, update typehal.config.ts and re-run the transpiler.",
    "//",
    `// Board: ${config.board}`,
    "// ---------------------------------------------------------------------------",
    "",
    "declare global {",
    "  type Owned<T = any> = T;",
    "  type Shared<T = any> = T;",
    "  type Mutable<T = any> = T;",
    "",
    "  // C-style explicit number types recognized by the transpiler",
    "  type uint8_t = number;",
    "  type int8_t = number;",
    "  type uint16_t = number;",
    "  type int16_t = number;",
    "  type uint32_t = number;",
    "  type int32_t = number;",
    "  type size_t = number;",
    "  type float = number;",
    "  type double = number;",
    "",
    "  // Convenience helper for volatile variables in TypeHAL programs.",
    "  // The transpiler detects calls to volatile() and emits the C++ volatile qualifier.",
    "  declare function volatile<T>(value: T): T;",
    "",
    "  // JS-style timers",
    "  declare function setInterval(handler: () => void, timeout?: number): number;",
    "  declare function setTimeout(handler: () => void, timeout?: number): number;",
    "  declare function clearInterval(id: number): void;",
    "  declare function clearTimeout(id: number): void;",
    ...(platformDeclarations ?? []),
    "}",
    "",
    "declare module '@typehal' {",
    `  ${typehalExport}`,
    "}",
    "",
    "export {};",
    "",
  ].join("\n");

  fs.writeFileSync(outPath, content, "utf-8");
}


/**
 * High-level entry point: find and load `typehal.config.ts` starting from
 * the given directory (typically the directory of the input .ts file).
 *
 * Returns `undefined` when no config file is found — the caller should
 * fall back to legacy behaviour (board determined by imports).
 */
export function loadTypehalConfig(startDir: string): ResolvedTypehalConfig | undefined {
  const configPath = findConfigFile(startDir);
  if (!configPath) return undefined;
  return parseConfigFile(configPath);
}
