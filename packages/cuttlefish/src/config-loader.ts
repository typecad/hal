// ---------------------------------------------------------------------------
// Config loader — reads and parses cuttlefish.config.ts
//
// Walks up from a given directory to locate `cuttlefish.config.ts`, then parses
// it with the TypeScript compiler API to extract the scalar config values.
// This mirrors the AST-based approach used by board-resolver.ts so we avoid
// any runtime evaluation (no ts-node / dynamic import needed).
// ---------------------------------------------------------------------------

import path from "node:path";
import fs from "node:fs";
import ts from "typescript";
import { findBoardPackageDir, readTestPinsFile, buildTestPinsModuleContent } from "./transpile/test-pins.js";
import { safeValidateConfig } from "./config-schema.js";

/** The filename we search for when walking up directories. */
const CONFIG_FILENAME = "cuttlefish.config.ts";

/** Top-level keys recognized by CuttlefishConfigSchema — used to warn about
 *  misspelled keys that the AST extraction would otherwise drop silently. */
const KNOWN_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  "entry", "target", "mcu", "board", "contract", "framework", "psram",
  "output", "frameworkData", "include", "exclude", "test", "toolchain",
  "console", "native", "zephyr", "display",
]);

/**
 * Resolved configuration values extracted from `cuttlefish.config.ts`.
 * Only the fields relevant to the transpiler are included — complex
 * nested objects (like `output`) are flattened into simple scalars.
 */
export interface ResolvedCuttlefishConfig {
  target?: string;
  /** MCU package specifier (e.g. '@typecad/mcu-atmega328p'). */
  mcu?: string;
  /** Board package specifier (e.g. '@typecad/board-arduino-uno'). Layers
   *  board-level assets (silkscreen aliases, onboard devices, probe methods,
   *  build targets) on top of the MCU package. Optional: an MCU-only config
   *  (mcu set, board absent) programs bare silicon — on Zephyr via a
   *  generated custom board (`zephyr.customBoard: true`). */
  board?: string;
  /** Path to a TypeCAD contract file (*.contract.json). */
  contract?: string;
  /** Build target identifier (e.g. FQBN for Arduino CLI). */
  buildTarget?: string;
  /** Output framework (e.g. 'arduino'). */
  outputFramework?: string;
  /** Output directory. */
  outputOutDir?: string;
  /**
   * Framework package for code generation strategy.
   * Can be '@typecad/framework-arduino', '@typecad/framework-zephyr',
   * '@typecad/framework-native', or a custom path.
   */
  framework?: string;
  /** ESP32 PSRAM type ('opi' | 'quad') when the target board has PSRAM. */
  psram?: 'opi' | 'quad';
  /** Entry point TypeScript file (relative to config file directory). */
  entry?: string;
  /** Path to the config file that was loaded. */
  configPath: string;
  /** Console polyfill configuration. */
  console?: {
    baudRate?: number;
    port?: string;
    /** Where console.log output goes ('usb' = the USB CDC serial port). */
    output?: 'default' | 'usb';
  };
  /** Extra compiler flags from `output.extraFlags`. */
  outputExtraFlags?: string[];
  /** Additional defines from `output.defines`. */
  outputDefines?: Record<string, string>;
  /** Framework-specific config (e.g. `native` section). */
  frameworkConfig?: Record<string, unknown>;
  /** Zephyr-specific config (e.g. `zephyr` section). */
  zephyrConfig?: Record<string, unknown>;
  /** Display profile config. */
  display?: import("./api/shared/display-profile.js").DisplayConfig;
}

/**
 * Search upward from `startDir` for a file named `cuttlefish.config.ts`.
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

/**
 * Warn about config values the AST-only parser cannot evaluate. The loader
 * deliberately never runs user code (no ts-node / dynamic import), so only
 * inline literals survive extraction; without these warnings a value like
 * `libraries: sdlLibraries` (an identifier) used to vanish silently and
 * surface later as an opaque link error.
 */
export type ConfigDropWarning = (message: string) => void;

function unwrapTypeCast(node: ts.Expression): ts.Expression {
  let curr = node;
  for (;;) {
    if (ts.isAsExpression(curr) || ts.isTypeAssertionExpression(curr) || ts.isParenthesizedExpression(curr)) {
      curr = curr.expression;
      continue;
    }
    // satisfies is TS ≥4.9 — guard for older typings, then cast for .expression.
    const isSatisfies = (ts as any).isSatisfiesExpression as ((n: ts.Node) => boolean) | undefined;
    if (typeof isSatisfies === "function" && isSatisfies(curr)) {
      curr = (curr as ts.SatisfiesExpression).expression;
      continue;
    }
    return curr;
  }
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
  // Negative (and explicitly positive) number literals parse as
  // PrefixUnaryExpression — `reset: -1` used to be silently dropped.
  if (ts.isPrefixUnaryExpression(unwrapped)
    && (unwrapped.operator === ts.SyntaxKind.MinusToken || unwrapped.operator === ts.SyntaxKind.PlusToken)
    && ts.isNumericLiteral(unwrapped.operand)) {
    const magnitude = Number(unwrapped.operand.text);
    return unwrapped.operator === ts.SyntaxKind.MinusToken ? -magnitude : magnitude;
  }
  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

/** True for `null` / `undefined` literals — inline literals, but not values
 *  the config shape supports; callers warn with an accurate message instead
 *  of the "variables/ternaries" text. */
function isNullishLiteral(node: ts.Expression): boolean {
  const kind = unwrapTypeCast(node).kind;
  return kind === ts.SyntaxKind.NullKeyword || kind === ts.SyntaxKind.UndefinedKeyword;
}

/**
 * Walk an object literal and collect all scalar (string / number / boolean)
 * property values into a flat dot-path map — exactly like board-resolver.ts.
 */
/** Property key text for Identifier/StringLiteral names, else undefined
 *  (SpreadAssignment has no name; computed keys are not static text). */
function propertyKeyName(prop: ts.ObjectLiteralElement): string | undefined {
  const name = (prop as any).name as ts.PropertyName | undefined;
  if (!name) return undefined;
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

function describePropertyKey(prop: ts.ObjectLiteralElement): string {
  return propertyKeyName(prop) ?? "<unnamed>";
}

function walkObjectLiteral(
  obj: ts.ObjectLiteralExpression,
  prefix: string,
  out: Map<string, string | number | boolean>,
  warn?: ConfigDropWarning,
): void {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      if (warn) {
        const label = prefix ? `${prefix}.${describePropertyKey(prop)}` : describePropertyKey(prop);
        warn(`'${label}' uses ${ts.SyntaxKind[prop.kind]} syntax (shorthand/spread/method) — only property assignments are supported, ignored.`);
      }
      continue;
    }
    const key = ts.isIdentifier(prop.name)
      ? prop.name.text
      : ts.isStringLiteral(prop.name)
        ? prop.name.text
        : undefined;
    if (!key) continue;

    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (ts.isObjectLiteralExpression(prop.initializer)) {
      walkObjectLiteral(prop.initializer, fullKey, out, warn);
    } else if (ts.isArrayLiteralExpression(prop.initializer)) {
      // Arrays are extracted by the dedicated array extractors
      // (output.extraFlags, zephyr.cmakeArgs, native.libraries, …), not the
      // flat scalar walk — skip here without warning.
    } else {
      const value = getScalarValue(prop.initializer);
      if (value !== undefined) {
        out.set(fullKey, value);
      } else if (warn) {
        // Message text must stay byte-identical to extractObjectAsRecord's —
        // sections walked by both (native, display) rely on the warn-site
        // dedup to print one warning per dropped value, not two.
        warn(isNullishLiteral(prop.initializer)
          ? `'${fullKey}' is a null/undefined literal — not a supported config value, ignored.`
          : `'${fullKey}' is not an inline literal (variables, ternaries, and template substitutions are not evaluated) — ignored.`);
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
  warn?: ConfigDropWarning,
): string[] | undefined {
  const label = path.join(".");
  const leaf = navigateToObjectProperty(obj, path);
  if (!leaf || !ts.isArrayLiteralExpression(leaf)) {
    if (leaf && warn) warn(`'${label}' is not an inline array literal — ignored.`);
    return undefined;
  }
  return extractStringArrayFromArrayLiteral(leaf, warn, label);
}

function extractStringRecord(
  obj: ts.ObjectLiteralExpression,
  path: string[],
  warn?: ConfigDropWarning,
): Record<string, string> | undefined {
  const label = path.join(".");
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
    if (value === undefined) {
      if (warn) warn(`'${label}.${key}' is not a string literal — the whole record is ignored.`);
      return undefined;
    }
    result[key] = value;
  }
  if (Object.keys(result).length === 0) return undefined;
  return result;
}

/**
 * Recursively extract an object literal as Record<string, unknown>.
 * Handles strings, numbers, booleans, string arrays, and nested objects.
 */
function extractObjectAsRecord(
  obj: ts.ObjectLiteralExpression,
  warn?: ConfigDropWarning,
  prefix = "",
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      if (warn) {
        // Byte-identical to walkObjectLiteral's message for the same property
        // so the warn-site dedup collapses the double walk into one warning.
        const label = prefix ? `${prefix}.${describePropertyKey(prop)}` : describePropertyKey(prop);
        warn(`'${label}' uses ${ts.SyntaxKind[prop.kind]} syntax (shorthand/spread/method) — only property assignments are supported, ignored.`);
      }
      continue;
    }
    const key = ts.isIdentifier(prop.name)
      ? prop.name.text
      : ts.isStringLiteral(prop.name)
        ? prop.name.text
        : undefined;
    if (!key) continue;
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const init = prop.initializer;
    if (ts.isObjectLiteralExpression(init)) {
      result[key] = extractObjectAsRecord(init, warn, fullKey);
    } else if (ts.isArrayLiteralExpression(init)) {
      const arr = extractStringArrayFromArrayLiteral(init, warn, fullKey);
      if (arr) result[key] = arr;
    } else {
      const scalar = getScalarValue(init);
      if (scalar !== undefined) {
        result[key] = scalar;
      } else if (warn) {
        // Keep byte-identical to walkObjectLiteral's message (see above).
        warn(isNullishLiteral(init)
          ? `'${fullKey}' is a null/undefined literal — not a supported config value, ignored.`
          : `'${fullKey}' is not an inline literal (variables, ternaries, and template substitutions are not evaluated) — ignored.`);
      }
    }
  }
  return result;
}

function extractStringArrayFromArrayLiteral(
  node: ts.ArrayLiteralExpression,
  warn?: ConfigDropWarning,
  label = "array",
): string[] | undefined {
  const result: string[] = [];
  for (const elem of node.elements) {
    const s = getStringLiteral(elem);
    if (s === undefined) {
      if (warn) warn(`'${label}' has a non-string-literal element — the whole array is ignored.`);
      return undefined;
    }
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
  warn?: ConfigDropWarning,
): Record<string, unknown> | undefined {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = ts.isIdentifier(prop.name)
      ? prop.name.text
      : ts.isStringLiteral(prop.name)
        ? prop.name.text
        : undefined;
    if (key !== sectionName) continue;
    if (!ts.isObjectLiteralExpression(prop.initializer)) {
      if (warn) warn(`'${sectionName}' section is not an inline object literal — ignored.`);
      return undefined;
    }
    return extractObjectAsRecord(prop.initializer, warn, sectionName);
  }
  return undefined;
}

/**
 *
 * The file must have a default export whose initializer is an object literal.
 * We find it by looking for:
 *   1. `export default <object>` — an ExportAssignment referencing a variable
 *   2. `const config: CuttlefishConfig = { ... };` followed by `export default config;`
 *
 * Returns `undefined` if the file cannot be parsed or has no recognizable config.
 */
export function parseConfigFile(configPath: string): ResolvedCuttlefishConfig | undefined {
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
      // Unwrap `export default { ... } satisfies CuttlefishConfig` /
      // `as const` / parenthesized forms down to the underlying expression.
      const expr = unwrapTypeCast(stmt.expression);
      if (ts.isIdentifier(expr)) {
        defaultExportName = expr.text;
      } else if (ts.isObjectLiteralExpression(expr)) {
        inlineDefaultObject = expr;
      }
    }
  }

  // Resolve the config object literal.
  let configObject: ts.ObjectLiteralExpression | undefined = inlineDefaultObject;

  if (!configObject && defaultExportName) {
    const decl = variableDecls.get(defaultExportName);
    if (decl?.initializer) {
      // `const config = { ... } satisfies CuttlefishConfig` parses the
      // initializer as a SatisfiesExpression — unwrap to the object literal
      // so the whole config isn't silently ignored.
      const init = unwrapTypeCast(decl.initializer);
      if (ts.isObjectLiteralExpression(init)) {
        configObject = init;
      }
    }
  }

  if (!configObject) {
    return undefined;
  }

  // Collect drop warnings (values the AST-only parser can't evaluate) and
  // print them once after parsing — silent drops here used to surface much
  // later as missing -l flags / reverted defaults with no diagnostic.
  const dropWarnings: string[] = [];
  const seenWarnings = new Set<string>();
  const warn: ConfigDropWarning = (message) => {
    const line = `${path.basename(configPath)}: ${message}`;
    if (!seenWarnings.has(line)) {
      seenWarnings.add(line);
      dropWarnings.push(line);
    }
  };

  // Typos in top-level keys (e.g. `output.optmize`) were dropped before
  // schema validation, so the strict schema never saw them — check the raw
  // source keys against the known set directly.
  for (const prop of configObject.properties) {
    const key = propertyKeyName(prop);
    if (key && !KNOWN_TOP_LEVEL_KEYS.has(key)) {
      warn(`unknown top-level key '${key}' — misspelled or unsupported.`);
    }
  }

  // Walk the object literal into a flat map.
  const flat = new Map<string, string | number | boolean>();
  walkObjectLiteral(configObject, "", flat, warn);

  // Map flat keys to the resolved config shape.
  const resolved: ResolvedCuttlefishConfig = { configPath };

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

  const psram = flat.get("psram");
  if (typeof psram === "string") {
    // Assign any string (including "") so the schema's PsramType enum rejects
    // typos ('octal') with a validation error instead of silently dropping it.
    resolved.psram = psram as "opi" | "quad";
  }

  const outputFramework = flat.get("output.framework");
  if (typeof outputFramework === "string") resolved.outputFramework = outputFramework;

  // `output.optimize` is removed: no framework ever consumed it (the only
  // consumer, framework-esp32, is deleted). Warn-and-drop instead of failing
  // strict validation, so existing configs keep building while telling the
  // user to delete the key. Optimization is framework territory — e.g.
  // `zephyr.kconfig` CONFIG_*_OPTIMIZATIONS symbols.
  if (flat.has("output.optimize")) {
    warn(
      "'output.optimize' has no effect and is deprecated — remove it. " +
        "Control optimization via the framework (e.g. zephyr.kconfig CONFIG_SIZE_OPTIMIZATIONS / CONFIG_SPEED_OPTIMIZATIONS).",
    );
  }

  const outputOutDir = flat.get("output.outDir");
  if (typeof outputOutDir === "string") resolved.outputOutDir = outputOutDir;

  // Parse console configuration
  const consoleBaudRate = flat.get("console.baudRate");
  const consolePort = flat.get("console.port");
  const consoleOutput = flat.get("console.output");
  const consoleOutputTyped =
    consoleOutput === "usb" || consoleOutput === "default" ? consoleOutput : undefined;
  if (typeof consoleBaudRate === "number" || typeof consolePort === "string" || consoleOutputTyped) {
    resolved.console = {
      ...(typeof consoleBaudRate === "number" ? { baudRate: consoleBaudRate } : {}),
      ...(typeof consolePort === "string" ? { port: consolePort } : {}),
      ...(consoleOutputTyped ? { output: consoleOutputTyped } : {}),
    };
  }

  // Extract structured fields that the flat walker cannot handle.
  const outputExtraFlags = extractStringArray(configObject, ["output", "extraFlags"], warn);
  if (outputExtraFlags) resolved.outputExtraFlags = outputExtraFlags;

  const outputDefines = extractStringRecord(configObject, ["output", "defines"], warn);
  if (outputDefines) resolved.outputDefines = outputDefines;

  const nativeSection = extractFrameworkSection(configObject, "native", warn);
  if (nativeSection) {
    resolved.frameworkConfig = nativeSection;
  }

  // Parse zephyr-specific config section.
  const zephyrKconfig = extractStringRecord(configObject, ["zephyr", "kconfig"], warn);
  const zephyrCmakeArgs = extractStringArray(configObject, ["zephyr", "cmakeArgs"], warn);
  const zephyrRunnerArgs = extractStringArray(configObject, ["zephyr", "runnerArgs"], warn);
  const zephyrRunner = flat.get("zephyr.runner");
  const zephyrProbe = flat.get("zephyr.probe");
  const zephyrCustomBoard = flat.get("zephyr.customBoard");
  if (zephyrKconfig || zephyrCmakeArgs || zephyrRunnerArgs || typeof zephyrRunner === "string" || typeof zephyrProbe === "string" || typeof zephyrCustomBoard === "boolean") {
    resolved.zephyrConfig = {
      ...(zephyrKconfig ? { kconfig: zephyrKconfig } : {}),
      ...(zephyrCmakeArgs ? { cmakeArgs: zephyrCmakeArgs } : {}),
      ...(zephyrRunnerArgs ? { runnerArgs: zephyrRunnerArgs } : {}),
      ...(typeof zephyrProbe === "string" ? { probe: zephyrProbe } : {}),
      ...(typeof zephyrRunner === "string" ? { runner: zephyrRunner } : {}),
      ...(zephyrCustomBoard === true ? { customBoard: true } : {}),
    };
  }

  // Parse display profile config (nested object with profile name, wiring, touch)
  const displaySection = extractFrameworkSection(configObject, "display", warn);
  // extractObjectAsRecord walks literals into a loose record; the shape is
  // checked downstream (schema passthrough + display-profile resolution), so
  // bridge it to the declared DisplayConfig type at this single boundary.
  if (displaySection) resolved.display = displaySection as ResolvedCuttlefishConfig["display"];

  // Validate the parsed config against the Zod schema.
  // Reconstruct a structured object from the flat-map extraction for validation.
  const structuredForValidation: Record<string, unknown> = {};
  if (resolved.target) structuredForValidation.target = resolved.target;
  if (resolved.mcu) structuredForValidation.mcu = resolved.mcu;
  if (resolved.board) structuredForValidation.board = resolved.board;
  if (resolved.contract) structuredForValidation.contract = resolved.contract;
  if (resolved.entry) structuredForValidation.entry = resolved.entry;
  if (resolved.framework) structuredForValidation.framework = resolved.framework;
  // `!== undefined` (not truthiness) so an empty-string psram reaches the
  // PsramType enum and fails validation instead of vanishing.
  if (resolved.psram !== undefined) structuredForValidation.psram = resolved.psram;
  if (resolved.outputFramework || resolved.outputOutDir || resolved.outputExtraFlags || resolved.outputDefines) {
    structuredForValidation.output = {
      ...(resolved.outputFramework ? { framework: resolved.outputFramework } : {}),
      ...(resolved.outputOutDir ? { outDir: resolved.outputOutDir } : {}),
      ...(resolved.outputExtraFlags ? { extraFlags: resolved.outputExtraFlags } : {}),
      ...(resolved.outputDefines ? { defines: resolved.outputDefines } : {}),
    };
  }
  if (resolved.console) structuredForValidation.console = resolved.console;
  if (resolved.zephyrConfig) structuredForValidation.zephyr = resolved.zephyrConfig;
  if (resolved.frameworkConfig) structuredForValidation.native = resolved.frameworkConfig;
  if (resolved.display) structuredForValidation.display = resolved.display;
  if (resolved.buildTarget) {
    structuredForValidation.frameworkData = { buildTarget: resolved.buildTarget };
  }

  const validation = safeValidateConfig(structuredForValidation);
  if (!validation.success) {
    const errorMsg = validation.errors.map(e => `  - ${e}`).join("\n");
    throw new Error(`Configuration validation failed for ${configPath}:\n${errorMsg}`);
  }

  if (dropWarnings.length > 0) {
    console.warn(`⚠ ${configPath}: some values were ignored (the parser only evaluates inline literals):`);
    for (const w of dropWarnings) {
      console.warn(`  ${w}`);
    }
  }

  return resolved;
}

/**
 * Generates (or updates) a `cuttlefish-env.d.ts` file next to the config file.
 *
 * The file declares an ambient `@typecad/board` module that simply re-exports
 * everything from the concrete board package.  This lets the TypeScript
 * language server resolve `import { ... } from '@typecad/board'` in user files.
 *
 * The file is regenerated on every transpiler run so it stays in sync when
 * the board changes in `cuttlefish.config.ts`.
 */
export function generateVirtualTypeDeclaration(config: ResolvedCuttlefishConfig, platformDeclarations?: string[]): void {
  if (!config.mcu && !config.board) {
    // For native targets with no board/mcu, still generate declarations
    if (!platformDeclarations || platformDeclarations.length === 0) return;
  }

  const configDir = path.dirname(config.configPath);
  const cuttlefishDir = path.join(configDir, ".cuttlefish");
  const outPath = path.join(cuttlefishDir, "cuttlefish-env.d.ts");

  // Ensure .cuttlefish/ exists (it may not on first build of a non-scaffolded project)
  if (!fs.existsSync(cuttlefishDir)) {
    fs.mkdirSync(cuttlefishDir, { recursive: true });
  }

  // Determine what @typecad/board exports
  let boardExport = "";
  if (config.contract) {
    // Contract-based: export from generated board (same dir — .cuttlefish/)
    boardExport = "export * from './board.js';";
  } else if (config.board) {
    // Explicit board package (legacy)
    boardExport = `export * from '${config.board}';`;
  } else if (config.mcu) {
    // MCU-only: export all from MCU
    boardExport = `export * from '${config.mcu}';`;
  } else {
    // Native target with no board/mcu: empty export
    boardExport = "";
  }

  const content = [
    "// ---------------------------------------------------------------------------",
    "// cuttlefish-env.d.ts — Virtual module declaration for '@typecad/board'",
    "//",
    "// Auto-generated by the cuttlefish transpiler. Do not edit manually.",
    "// To change the board, update cuttlefish.config.ts and re-run the transpiler.",
    "//",
    `// Board: ${config.board ?? config.mcu ?? "native"}`,
    "// ---------------------------------------------------------------------------",
    "",
    "declare global {",
    "  type Owned<T = unknown> = T;",
    "  type Shared<T = unknown> = T;",
    "  type Mutable<T = unknown> = T;",
    "",
    "  // SafeVariable: SEU-resistant storage. The transpiler lowers SafeVariable<number>",
    "  // to a C++ template with inverted-redundancy storage. Declared as an interface",
    "  // (not a type alias) so the TS type checker recognizes method calls.",
    "  // Arithmetic T only (integral or floating-point); string is rejected by a",
    "  // static_assert in the emitted C++ template.",
    "  interface SafeVariable<T = number> { set(value: T): void; get(): T; valid(): boolean; hasFault(): boolean; }",
    "  // SafeInt: chainable bounds-checked signed-integer arithmetic. The transpiler",
    "  // lowers SafeInt<number> to SafeInt<int32_t> (a C++ template with sticky-fault",
    "  // overflow detection). Signed integer T only — unsigned/bool/float/string are",
    "  // rejected by a static_assert in the emitted C++ template.",
    "  interface SafeInt<T = number> {",
    "    add(delta: T): SafeInt<T>; sub(delta: T): SafeInt<T>;",
    "    mul(factor: T): SafeInt<T>; divide(d: T): SafeInt<T>; mod(d: T): SafeInt<T>;",
    "    negate(): SafeInt<T>; absValue(): SafeInt<T>;",
    "    get(): T; hasFault(): boolean; valid(): boolean; reset(newValue: T): void;",
    "  }",
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
    "  // console — declared here (not pulled from lib.dom) so a project does not",
    "  // need \"dom\" in tsconfig lib just to type console.log. Avoiding lib.dom",
    "  // also keeps DOM global type names (Node, Element, Event, Document, ...)",
    "  // out of scope, so a user class named e.g. `Node` is not shadowed by the",
    "  // DOM global of the same name. Platforms may declaration-merge extra",
    "  // members onto this interface via ambientTypeDeclarations().",
    "  interface Console {",
    "    log(...args: unknown[]): void;",
    "    info(...args: unknown[]): void;",
    "    debug(...args: unknown[]): void;",
    "    warn(...args: unknown[]): void;",
    "    error(...args: unknown[]): void;",
    "  }",
    "  const console: Console;",
    "",
    "  // Convenience helper for volatile variables in TypeCAD programs.",
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
    "declare module '@typecad/board' {",
    `  ${boardExport}`,
    "  export type Owned<T = unknown> = T;",
    "  export type Shared<T = unknown> = T;",
    "  export type Mutable<T = unknown> = T;",
    "}",
    "",
    "export {};",
    "",
  ].join("\n");

  fs.writeFileSync(outPath, content, "utf-8");

  // Also write a `.cuttlefish/board.ts` re-export. The scaffolded tsconfig.json
  // path mapping points the virtual specifier ("@typecad/board") at this file so
  // the TypeScript language server and the transpiler's type-check resolve
  // `import { ... } from '@typecad/board'` to the configured board — which
  // re-exports the HAL plus board-specific pins. Without this, the ambient
  // `declare module` in cuttlefish-env.d.ts is treated as module augmentation
  // (because that file has `export {}`), which can't define a new module.
  //
  // For contract-based configs, the narrowed board.ts is generated by the
  // contract reader (`contract/board-generator.ts`, invoked from cli.ts before
  // this function runs), so don't overwrite it with the generic re-export here.
  if (!config.contract && (config.board || config.mcu)) {
    const reExportSource = config.board ?? config.mcu!;
    const boardTsPath = path.join(cuttlefishDir, "board.ts");
    const boardTsContent = [
      `// Auto-generated by the cuttlefish transpiler. Do not edit manually.`,
      `// Re-exports the configured board/MCU package so the tsconfig path`,
      `// mapping for the virtual "@typecad/board" specifier resolves correctly.`,
      `export * from '${reExportSource}';`,
      ``,
    ].join("\n");
    fs.writeFileSync(boardTsPath, boardTsContent, "utf-8");
  }

  // Boards that ship a test-pins.json get a sibling .cuttlefish/test-pins.ts
  // re-export, so the language server resolves the '@typecad/test-pins'
  // virtual specifier to the same role consts the transpiler generates.
  if (config.board) {
    const boardDir = findBoardPackageDir(config.board, configDir);
    const testPinsData = boardDir ? readTestPinsFile(boardDir) : undefined;
    const testPinsContent = testPinsData
      ? buildTestPinsModuleContent(config.board, testPinsData)
      : undefined;
    if (testPinsContent) {
      const testPinsTsPath = path.join(cuttlefishDir, "test-pins.ts");
      const existing = fs.existsSync(testPinsTsPath)
        ? fs.readFileSync(testPinsTsPath, "utf8")
        : undefined;
      const withHeader = testPinsContent.replace(
        /^\/\/ Generated from/,
        "// Auto-generated by the cuttlefish transpiler. Do not edit manually.\n// Generated from",
      );
      if (existing !== withHeader) {
        fs.writeFileSync(testPinsTsPath, withHeader, "utf-8");
      }
    }
  }
}


/**
 * High-level entry point: find and load `cuttlefish.config.ts` starting from
 * the given directory (typically the directory of the input .ts file).
 *
 * Returns `undefined` when no config file is found — the caller should
 * fall back to legacy behaviour (board determined by imports).
 */
export function loadCuttlefishConfig(startDir: string): ResolvedCuttlefishConfig | undefined {
  const configPath = findConfigFile(startDir);
  if (!configPath) return undefined;
  return parseConfigFile(configPath);
}
