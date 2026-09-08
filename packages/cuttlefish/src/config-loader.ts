// ---------------------------------------------------------------------------
// Config loader — reads and parses typecad-hal.config.ts
//
// Walks up from a given directory to locate `typecad-hal.config.ts`, then parses
// it with the TypeScript compiler API to extract the scalar config values.
// This mirrors the AST-based approach used by board-resolver.ts so we avoid
// any runtime evaluation (no ts-node / dynamic import needed).
// ---------------------------------------------------------------------------

import path from "node:path";
import fs from "node:fs";
import ts from "typescript";
import { createRequire } from "node:module";
import {
  loadBoardCatalogOverlay,
  ensureFreshBoardCatalog,
  boardRecordFingerprint,
  factsFingerprint,
  findBoardInCatalog,
} from "./board-catalog/index.js";
import { fileURLToPath } from "node:url";
import { readTestPinsFile, buildTestPinsModuleContent } from "./transpile/test-pins.js";
import { safeValidateConfig } from "./config-schema.js";
import { setHALProjectDir } from "./ir/hal-resolver.js";

/** The filename we search for when walking up directories. */
const CONFIG_FILENAME = "typecad-hal.config.ts";

/** Top-level keys recognized by TypecadConfigSchema — used to warn about
 *  misspelled keys that the AST extraction would otherwise drop silently. */
const KNOWN_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  "entry", "target", "board", "soc", "contract", "framework", "psram",
  "output", "frameworkData", "include", "exclude", "test", "toolchain",
  "console", "native", "zephyr", "display",
]);

/**
 * Resolved configuration values extracted from `typecad-hal.config.ts`.
 * Only the fields relevant to the transpiler are included — complex
 * nested objects (like `output`) are flattened into simple scalars.
 */
export interface ResolvedTypecadConfig {
  target?: string;
  /** Zephyr board target — the qualified `west build -b` argument (e.g.
   *  'esp32s3_devkitc/esp32s3/procpu'). The project-local board module is
   *  generated from the framework's board data pack on first build. */
  board?: string;
  /** Zephyr SoC name for contract-based projects (custom PCBs, no board
   *  target) — e.g. 'stm32f411xe'. Selects the curated soc descriptor. */
  soc?: string;
  /** Path to a TypeCAD contract file (*.contract.json). */
  contract?: string;
  /** Build target identifier (the framework's board id, e.g. 'blackpill_f411ce/stm32f411xe'). */
  buildTarget?: string;
  /** Output framework (e.g. 'zephyr'). */
  outputFramework?: string;
  /** Output directory. */
  outputOutDir?: string;
  /**
   * Framework package for code generation strategy.
   * Can be '@typecad/framework-zephyr', '@typecad/framework-native',
   * '@typecad/framework-native', or a custom path.
   */
  framework?: string;
  /** ESP32 PSRAM type ('opi' | 'quad') when the target board has PSRAM. */
  psram?: 'opi' | 'quad';
  /** Entry point TypeScript file (relative to config file directory). */
  entry?: string;
  /** Path to the config file that was loaded. */
  configPath: string;
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
 * Search upward from `startDir` for a file named `typecad-hal.config.ts`.
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
 *   2. `const config: TypecadConfig = { ... };` followed by `export default config;`
 *
 * Returns `undefined` if the file cannot be parsed or has no recognizable config.
 */
export function parseConfigFile(configPath: string): ResolvedTypecadConfig | undefined {
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
      // Unwrap `export default { ... } satisfies TypecadConfig` /
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
      // `const config = { ... } satisfies TypecadConfig` parses the
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
  const resolved: ResolvedTypecadConfig = { configPath };

  const entry = flat.get("entry");
  if (typeof entry === "string") resolved.entry = entry;

  const target = flat.get("target");
  if (typeof target === "string") resolved.target = target;

  const soc = flat.get("soc");
  if (typeof soc === "string") resolved.soc = soc;

  const board = flat.get("board");
  if (typeof board === "string") resolved.board = board;

  const contract = flat.get("contract");
  if (typeof contract === "string") resolved.contract = contract;

  // The build target (what `west build -b` receives) has a single source of
  // truth: `board:` for board-target projects. `frameworkData.buildTarget`
  // is honored only for board-less projects (bare silicon / contract, whose
  // build target is a generated custom board). When both are present they
  // must agree — a disagreement is the split-brain trap (board module for
  // one board, firmware for another), so board wins with a warning.
  const buildTargetFlat = flat.get("frameworkData.buildTarget");
  if (typeof board === "string") {
    if (typeof buildTargetFlat === "string" && buildTargetFlat !== board) {
      warn(
        `config sets both board: '${board}' and frameworkData.buildTarget: '${buildTargetFlat}' — ` +
          `they disagree. 'board' is the source of truth; building for '${board}'. ` +
          `Remove the stale frameworkData.buildTarget entry.`,
      );
    }
    resolved.buildTarget = board;
  } else if (typeof buildTargetFlat === "string") {
    resolved.buildTarget = buildTargetFlat;
  }

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

  // The `console` section is removed: the console.* carry-over (console.log
  // lowering to a platform print, plus this section routing/parameterizing it)
  // is gone. Programs write to a serial console explicitly — USB0.writeLine
  // or UART0.writeLine from the board module. Warn-and-drop so existing
  // configs keep building while telling the user to delete the key.
  for (const key of flat.keys()) {
    if (key === "console" || key.startsWith("console.")) {
      warn(
        `'${key}' is removed — the console.* carry-over is gone. ` +
          "Write to a serial console explicitly (USB0.writeLine(...) / UART0.writeLine(...)) and delete the console section.",
      );
    }
  }

  const outputOutDir = flat.get("output.outDir");
  if (typeof outputOutDir === "string") resolved.outputOutDir = outputOutDir;

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
  if (displaySection) resolved.display = displaySection as ResolvedTypecadConfig["display"];

  // Validate the parsed config against the Zod schema.
  // Reconstruct a structured object from the flat-map extraction for validation.
  const structuredForValidation: Record<string, unknown> = {};
  if (resolved.target) structuredForValidation.target = resolved.target;
  if (resolved.soc) structuredForValidation.soc = resolved.soc;
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
 * Generates (or updates) a `typecad-hal-env.d.ts` file next to the config file.
 *
 * The file carries the global type declarations (Owned/Shared/Mutable,
 * SafeVariable/SafeInt, C-style number types, volatile(), platform ambient
 * declarations). The virtual hardware specifier needs NO ambient declaration:
 * user code imports everything from '@typecad/hal', which the project
 * tsconfig's paths mapping resolves onto the generated board module
 * (.typecad-hal/board.ts);
 * file. ('@typecad/hal' must never be ambient-declared — the declaration
 * would merge with the real package's exports.)
 *
 * The file is regenerated on every transpiler run so it stays in sync when
 * the board changes in `typecad-hal.config.ts`.
 */
/** Refresh a stale catalog overlay before the board-module check — fs-only
 *  discovery, re-walks the tree only when the provenance moved. Errors are
 *  swallowed deliberately: an offline or tree-less machine keeps whatever
 *  catalog it already has; generation surfaces the real problem. */
function refreshBoardCatalogQuietly(): void {
  try {
    ensureFreshBoardCatalog();
  } catch {
    // non-fatal by design
  }
}

/**
 * Ensure the generated board module (.typecad-hal/board.ts + board.json)
 * is current for a board-target config. Regen-first: any input change —
 * the config's board, the catalog overlay, the Zephyr tree, the generator
 * revision — recreates the module, so the emitted module is
 * project-pinned and diffable, not rebuilt on every compile. One exception:
 * when the module on disk is for a DIFFERENT board than config.board (the
 * user switched boards), it regenerates automatically — a stale module is
 * the split-brain trap, not something to pin.
 */
function ensureGeneratedBoard(config: ResolvedTypecadConfig, cuttlefishDir: string): void {
  const boardTsPath = path.join(cuttlefishDir, "board.ts");
  const boardJsonPath = path.join(cuttlefishDir, "board.json");
  // Anchor HAL source/gate resolution to this project BEFORE any board
  // generation runs — boardgen reads the ungated surface from the project's
  // own @typecad/hal copy, and this runs before transpileFile would set it.
  setHALProjectDir(path.dirname(config.configPath));
  // Regen-first: the board module is a derived artifact, recreated whenever
  // ANY input moves — the config's board target, the catalog overlay, the
  // Zephyr tree the overlay was generated from, or the extraction revision.
  // The check is cheap (fs-only provenance + a fingerprint compare); a
  // stale overlay re-walks the tree once, then this regenerates.
  refreshBoardCatalogQuietly();
  if (fs.existsSync(boardTsPath) && fs.existsSync(boardJsonPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(boardJsonPath, "utf8")) as {
        identifier?: string;
        source?: { generatorRev?: number; fingerprint?: string };
      };
      const sameBoard = existing.identifier
        && existing.identifier.toLowerCase() === config.board!.toLowerCase();
      const overlay = loadBoardCatalogOverlay();
      const entry = overlay && sameBoard ? findBoardInCatalog(overlay.data, config.board!) : undefined;
      const sameSource = entry && overlay
        ? existing.source?.fingerprint
          === boardRecordFingerprint(entry, overlay)
            + factsFingerprint(readUserFactsJson(config) ?? "")
            + factsFingerprint(readAsBuiltJson(config) ?? "")
        : true; // no overlay to verify against — keep the existing module
      if (sameBoard && sameSource) return;
    } catch {
      // Unreadable manifest — regenerate below rather than build on a
      // module of unknown provenance.
    }
  }
  // Missing files, a board mismatch, or a source change — (re)generate.
  const target = config.board!;
  if (!config.framework) {
    throw new Error(`Cannot generate the board module for '${target}' — no framework configured.`);
  }
  // The framework owns board generation; reach its strategy through the
  // configured package (exported as ZephyrStrategy / default). The package
  // is ESM ("type": "module"), so resolve it from the built dist through
  // createRequire against the project's node_modules resolution.
  const generated = loadFrameworkBoardModule(config, configDirOf(config), readUserFactsJson(config), readAsBuiltJson(config));
  if (!generated) {
    throw new Error(
      `Framework '${config.framework}' cannot generate a board module for '${target}'. ` +
      `Check the target against the framework's board catalog.`,
    );
  }
  // User-facts notes (shadowed harvest routes) surface once per regen —
  // the fingerprint keeps regens rare.
  for (const w of generated.warnings ?? []) console.warn(`typecad-hal: ${w}`);
  fs.writeFileSync(boardTsPath, generated.boardTs, "utf-8");
  fs.writeFileSync(boardJsonPath, generated.boardJson, "utf-8");
}

/**
 * Force-regenerate the project-local board module — the `typecad-hal board
 * regen` path. Board-target configs only: contract projects write their
 * board module through the contract reader, and native projects have none.
 * Returns the .typecad-hal directory the module was written to.
 */
export function regenBoardModule(config: ResolvedTypecadConfig): string {
  if (!config.board || config.contract) {
    throw new Error(
      "'typecad-hal board regen' applies to board-target projects. " +
      "Set 'board:' in typecad-hal.config.ts (contract projects regenerate on build).",
    );
  }
  const cuttlefishDir = path.join(path.dirname(config.configPath), ".typecad-hal");
  if (!fs.existsSync(cuttlefishDir)) {
    fs.mkdirSync(cuttlefishDir, { recursive: true });
  }
  fs.rmSync(path.join(cuttlefishDir, "board.ts"), { force: true });
  fs.rmSync(path.join(cuttlefishDir, "board.json"), { force: true });
  ensureGeneratedBoard(config, cuttlefishDir);
  return cuttlefishDir;
}

/** The subset of a platform strategy ensureGeneratedBoard needs. The
 *  optional factsJson is the project's raw typecad-hal.facts.json — user
 *  facts merge into the generated manifest, and the strategy hashes the
 *  same text into the module's source fingerprint. */
interface BoardGenStrategy {
  generateBoardModule?(target: string, opts?: { factsJson?: string; asBuiltJson?: string }): {
    boardTs: string;
    boardJson: string;
    warnings?: readonly string[];
  } | undefined;
}

/** The project's last-build snapshot (.typecad-hal/as-built.json, written by
 *  the framework toolchain after each successful west build). Absent →
 *  undefined; malformed content is handled downstream (soft ignore). */
function readAsBuiltJson(config: ResolvedTypecadConfig): string | undefined {
  const p = path.join(path.dirname(config.configPath), ".typecad-hal", "as-built.json");
  if (!fs.existsSync(p)) return undefined;
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return undefined; // best-effort enrichment — never blocks generation
  }
}

/** The project's raw typecad-hal.facts.json text, when one exists beside the
 *  config. Absent file → undefined; present-but-unreadable surfaces. */
function readUserFactsJson(config: ResolvedTypecadConfig): string | undefined {
  const factsPath = path.join(path.dirname(config.configPath), "typecad-hal.facts.json");
  if (!fs.existsSync(factsPath)) return undefined;
  try {
    return fs.readFileSync(factsPath, "utf8");
  } catch (err) {
    throw new Error(`typecad-hal.facts.json exists but cannot be read: ${(err as Error).message}`);
  }
}

/** Resolve the configured framework package's board generator. The framework
 *  packages are ESM, so this imports their built entry from the resolving
 *  project's node_modules (createRequire against the project dir).
 *  @param configDir  the project directory (where node_modules resolution starts) */
function configDirOf(config: ResolvedTypecadConfig): string {
  return path.dirname(config.configPath);
}

function loadFrameworkBoardModule(
  config: ResolvedTypecadConfig,
  configDir: string,
  factsJson?: string,
  asBuiltJson?: string,
): { boardTs: string; boardJson: string; warnings?: readonly string[] } | undefined {
  const target = config.board!;
  const spec = config.framework!;
  const tryResolve = (anchor: string) => {
    try {
      const projectRequire = createRequire(anchor);
      const mod = projectRequire(projectRequire.resolve(spec)) as {
        ZephyrStrategy?: new () => BoardGenStrategy;
        default?: unknown;
      };
      const Ctor = mod.ZephyrStrategy ?? (mod.default as (new () => BoardGenStrategy) | undefined);
      const strategy = typeof Ctor === "function" ? new Ctor() : undefined;
      const opts: { factsJson?: string; asBuiltJson?: string } = {};
      if (factsJson !== undefined) opts.factsJson = factsJson;
      if (asBuiltJson !== undefined) opts.asBuiltJson = asBuiltJson;
      return strategy?.generateBoardModule?.(target, Object.keys(opts).length > 0 ? opts : undefined) ?? undefined;
    } catch {
      return undefined;
    }
  };
  // Resolve from the project's package.json when it has one; projects without
  // one (bare configs, tests) fall back to cuttlefish's own resolution — the
  // framework is a peer of the tool in every real layout.
  return (
    tryResolve(path.join(configDir, "package.json")) ??
    tryResolve(path.join(path.dirname(fileURLToPath(import.meta.url)), "package.json"))
  );
}

export function generateVirtualTypeDeclaration(config: ResolvedTypecadConfig, platformDeclarations?: string[]): void {
  if (!config.board && !config.soc) {
    // For native targets with no board, still generate declarations
    if (!platformDeclarations || platformDeclarations.length === 0) return;
  }

  const configDir = path.dirname(config.configPath);
  const cuttlefishDir = path.join(configDir, ".typecad-hal");
  const outPath = path.join(cuttlefishDir, "typecad-hal-env.d.ts");

  // Ensure .typecad-hal/ exists (it may not on first build of a non-scaffolded project)
  if (!fs.existsSync(cuttlefishDir)) {
    fs.mkdirSync(cuttlefishDir, { recursive: true });
  }

  // Determine whether this project carries a board module at all (board
  // target or contract) — only affects the doc comment below.
  const hasBoardModule = !!(config.contract || config.board);

  // Board-target projects: ensure the generated board module exists. The
  // framework owns the generation (the Zephyr framework joins its board
  // data pack with its curated soc descriptors) — reach it through the
  // configured framework package's strategy hook.
  if (config.board && !config.contract) {
    ensureGeneratedBoard(config, cuttlefishDir);
  }

  // Doc-comment lines explaining how the virtual specifier resolves. There
  // is deliberately NO ambient `declare module` for '@typecad/hal' (it would
  // merge with the real package's exports) (an ambient declaration merged
  // onto the paths-resolved file hijacks the module's display name, so
  // narrowing errors would name the wrong specifier). The specifier resolves
  // through the tsconfig paths mapping.
  const boardComment = hasBoardModule
    ? [
        "//",
        "// User code imports everything from '@typecad/hal'; the project tsconfig's",
        "// paths mapping resolves that specifier onto .typecad-hal/board.ts —",
        "// the narrowed hardware gateway.",
      ]
    : [];

  const content = [
    "// ---------------------------------------------------------------------------",
    "// typecad-hal-env.d.ts — Global type declarations",
    "//",
    "// Auto-generated by the typecad-hal transpiler. Do not edit manually.",
    "// To change the board, update typecad-hal.config.ts and re-run the transpiler.",
    "//",
    `// Board: ${config.board ?? config.soc ?? "native"}`,
    ...boardComment,
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
    "  // Convenience helper for volatile variables in TypeCAD programs.",
    "  // The transpiler detects calls to volatile() and emits the C++ volatile qualifier.",
    "  declare function volatile<T>(value: T): T;",
    "",
    ...(platformDeclarations ?? []),
    "}",
    "",
    "export {};",
    "",
  ].join("\n");

  fs.writeFileSync(outPath, content, "utf8");

  // The .typecad-hal/board.ts module itself is written by ensureGeneratedBoard
  // (board-target configs, above) or the contract reader (invoked from cli.ts
  // before this function runs) — never a package re-export here, and never
  // through an ambient declaration. The scaffolded tsconfig path mappings
  // point the user-facing specifier ("@typecad/hal") at that file;
  // '@typecad/hal' must stay non-ambient so it never merges with the real
  // package's exports.

  // A project-local test-pins.json (board packages are gone — projects that
  // want role pins carry them) gets a sibling .typecad-hal/test-pins.ts
  // re-export, so the language server resolves the '@typecad/test-pins'
  // virtual specifier to the same role consts the transpiler generates.
  if (config.board) {
    const projectTestPins = path.join(configDir, "test-pins.json");
    const testPinsData = fs.existsSync(projectTestPins)
      ? readTestPinsFile(configDir)
      : undefined;
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
        "// Auto-generated by the typecad-hal transpiler. Do not edit manually.\n// Generated from",
      );
      if (existing !== withHeader) {
        fs.writeFileSync(testPinsTsPath, withHeader, "utf-8");
      }
    }
  }
}


/**
 * High-level entry point: find and load `typecad-hal.config.ts` starting from
 * the given directory (typically the directory of the input .ts file).
 *
 * Returns `undefined` when no config file is found — the caller should
 * fall back to legacy behaviour (board determined by imports).
 */
export function loadTypecadConfig(startDir: string): ResolvedTypecadConfig | undefined {
  const configPath = findConfigFile(startDir);
  if (!configPath) return undefined;
  return parseConfigFile(configPath);
}
