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
  /** Toolchain configuration. */
  toolchain?: {
    type?: 'arduino-cli' | 'platformio';
    arduinoCli?: {
      path?: string;
      configFile?: string;
      verbose?: boolean;
    };
    platformio?: {
      path?: string;
      env?: string;
    };
  };
  /** Console polyfill configuration. */
  console?: {
    baudRate?: number;
  };
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

  // Parse toolchain configuration
  const toolchainType = flat.get("toolchain.type");
  const arduinoCliPath = flat.get("toolchain.arduinoCli.path");
  const arduinoCliConfigFile = flat.get("toolchain.arduinoCli.configFile");
  const arduinoCliVerbose = flat.get("toolchain.arduinoCli.verbose");
  const platformioPath = flat.get("toolchain.platformio.path");
  const platformioEnv = flat.get("toolchain.platformio.env");

  if (
    typeof toolchainType === "string" ||
    typeof arduinoCliPath === "string" ||
    typeof arduinoCliConfigFile === "string" ||
    typeof platformioPath === "string" ||
    typeof platformioEnv === "string"
  ) {
    resolved.toolchain = {};

    if (toolchainType === "arduino-cli" || toolchainType === "platformio") {
      resolved.toolchain.type = toolchainType;
    }

    if (
      typeof arduinoCliPath === "string" ||
      typeof arduinoCliConfigFile === "string" ||
      typeof arduinoCliVerbose === "boolean"
    ) {
      resolved.toolchain.arduinoCli = {};
      if (typeof arduinoCliPath === "string") {
        resolved.toolchain.arduinoCli.path = arduinoCliPath;
      }
      if (typeof arduinoCliConfigFile === "string") {
        resolved.toolchain.arduinoCli.configFile = arduinoCliConfigFile;
      }
      if (typeof arduinoCliVerbose === "boolean") {
        resolved.toolchain.arduinoCli.verbose = arduinoCliVerbose;
      }
    }

    if (typeof platformioPath === "string" || typeof platformioEnv === "string") {
      resolved.toolchain.platformio = {};
      if (typeof platformioPath === "string") {
        resolved.toolchain.platformio.path = platformioPath;
      }
      if (typeof platformioEnv === "string") {
        resolved.toolchain.platformio.env = platformioEnv;
      }
    }
  }

  // Parse console configuration
  const consoleBaudRate = flat.get("console.baudRate");
  if (typeof consoleBaudRate === "number") {
    resolved.console = { baudRate: consoleBaudRate };
  }

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
 * Validate that a board package exists.
 * 
 * Checks both relative paths (packages/board-*) and npm packages (@typecode/board-*).
 * Returns an error message if validation fails, or undefined if valid.
 */
export function validateBoardPackage(board: string, configPath: string): string | undefined {
  const configDir = path.dirname(configPath);
  
  // Check if it's a relative path (packages/*, ./packages/*, ../packages/*)
  if (board.startsWith('.') || board.startsWith('packages/') || board.startsWith('/packages/')) {
    const resolvedPath = path.resolve(configDir, board);
    if (!fs.existsSync(resolvedPath)) {
      return `Board package directory not found: ${board}\n  Resolved to: ${resolvedPath}`;
    }
    if (!fs.statSync(resolvedPath).isDirectory()) {
      return `Board package path is not a directory: ${board}\n  Resolved to: ${resolvedPath}`;
    }
    // Check for package.json or src/index.ts
    const hasPackageJson = fs.existsSync(path.join(resolvedPath, 'package.json'));
    const hasIndexTs = fs.existsSync(path.join(resolvedPath, 'src', 'index.ts'));
    if (!hasPackageJson && !hasIndexTs) {
      return `Board package directory exists but is not a valid board package (missing package.json or src/index.ts): ${board}`;
    }
    return undefined; // Valid
  }
  
  // Check if it's an npm package (@typecode/board-* or similar)
  if (board.startsWith('@')) {
    try {
      const resolvedPath = require.resolve(board);
      // Package resolved successfully
      return undefined;
    } catch {
      return `Board package not found in node_modules: ${board}\n  Run 'npm install' or check the package name.`;
    }
  }
  
  // For other paths, try to resolve as a local path first, then as npm package
  const localPath = path.resolve(configDir, board);
  if (fs.existsSync(localPath) && fs.statSync(localPath).isDirectory()) {
    return undefined; // Valid local path
  }
  
  // Try npm resolution as fallback
  try {
    require.resolve(board);
    return undefined;
  } catch {
    return `Board package not found: ${board}\n  Checked as local path: ${localPath}\n  Also tried npm package resolution.`;
  }
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
