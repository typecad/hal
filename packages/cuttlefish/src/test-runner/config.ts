// ---------------------------------------------------------------------------
// cuttlefish test-runner — Configuration loader
//
// Reads the `typecad-hal.config.ts` file to extract both the base transpiler
// configuration and the optional `test` section for test-specific settings.
// ---------------------------------------------------------------------------

import path from 'node:path';
import fs from 'node:fs';
import ts from 'typescript';
import type { ResolvedConfig, TestConfig } from './types.js';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_TEST_CONFIG: TestConfig = {
  include: ['tests/**/*.test.ts'],
  port: '',  // Must be provided by user or CLI flag
  baudRate: 115200,
  timeout: 30000,
  serialOpenDelay: 500,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load configuration from `typecad-hal.config.ts` in the given project root.
 *
 * Parses the config file via the TypeScript AST (no dynamic import) to
 * extract scalar properties — consistent with how the typecad-hal CLI does it.
 *
 * @param projectRoot  Absolute path to the project root.
 * @param overrides    CLI flag overrides for test config.
 */
export function loadConfig(
  projectRoot: string,
  overrides: Partial<TestConfig> = {},
  explicitConfigPath?: string,
): ResolvedConfig {
  // An explicit --config path wins; otherwise discover typecad-hal.config.ts in
  // the project root. The explicit path lets a project hold several configs
  // (e.g. one per target board) and select one at run time instead of keeping
  // a single typecad-hal.config.ts as the only entry.
  const configPath = explicitConfigPath ?? findConfigFile(projectRoot);
  if (!configPath) {
    throw new Error(
      `No typecad-hal.config.ts found in ${projectRoot}. ` +
      `Create one or specify --port and --board on the command line.`
    );
  }

  const raw = parseConfigAST(configPath);

  // Merge test config: defaults < config file < CLI overrides
  const testFromFile = raw.test ?? {};
  const test: TestConfig = {
    include: overrides.include ?? testFromFile.include ?? DEFAULT_TEST_CONFIG.include,
    exclude: overrides.exclude ?? testFromFile.exclude,
    port: overrides.port ?? testFromFile.port ?? DEFAULT_TEST_CONFIG.port,
    // A CLI --port override disables USB discovery outright (explicit wins).
    usb: overrides.port ? undefined : (testFromFile.usb ?? overrides.usb),
    baudRate: overrides.baudRate ?? testFromFile.baudRate ?? DEFAULT_TEST_CONFIG.baudRate,
    timeout: overrides.timeout ?? testFromFile.timeout ?? DEFAULT_TEST_CONFIG.timeout,
    serialOpenDelay: overrides.serialOpenDelay ?? testFromFile.serialOpenDelay ?? DEFAULT_TEST_CONFIG.serialOpenDelay,
    resetAfterOpen: overrides.resetAfterOpen ?? testFromFile.resetAfterOpen ?? DEFAULT_TEST_CONFIG.resetAfterOpen,
    buildTarget: overrides.buildTarget ?? testFromFile.buildTarget,
    board: overrides.board ?? testFromFile.board,
    verbose: overrides.verbose ?? testFromFile.verbose,
  };

  return {
    test,
    // Board: is the source of truth for west's -b target (mirrors the
    // cuttlefish config-loader: frameworkData.buildTarget is the board-less
    // custom-board form). An explicit test.buildTarget overrides both.
    buildTarget: test.buildTarget ?? raw.board ?? raw.frameworkData?.buildTarget ?? '',
    board: test.board ?? raw.board ?? 'xiao_ble/nrf52840',
    target: raw.target ?? 'zephyr',
    framework: raw.framework,
    zephyrConfig: raw.zephyr,
    projectRoot,
    // The config file these values came from. writeBuildConfig re-reads it to
    // extract board/MCU for the transpile, so it must point at the same file
    // loadConfig parsed (not always the default typecad-hal.config.ts).
    configPath,
  };
}

// ---------------------------------------------------------------------------
// Internal — Config file discovery
// ---------------------------------------------------------------------------

function findConfigFile(projectRoot: string): string | undefined {
  const candidates = [
    path.join(projectRoot, 'typecad-hal.config.ts'),
    path.join(projectRoot, 'cuttlefish.config.js'),
  ];
  return candidates.find(c => fs.existsSync(c));
}

// ---------------------------------------------------------------------------
// Internal — AST-based config parsing
//
// We parse the config file purely via TypeScript AST, extracting object
// literal properties.  This mirrors the CLI's config-loader.ts approach
// but also extracts the `test` section.
// ---------------------------------------------------------------------------

export interface RawConfig {
  target?: string;
  board?: string;
  mcu?: string;
  frameworkData?: { buildTarget?: string };
  framework?: string;
  toolchain?: { type?: string };
  zephyr?: Record<string, unknown>;
  test?: Partial<TestConfig>;
  output?: {
    framework?: string;
    outDir?: string;
  };
}

/** Unwrap `as const` / `satisfies T` / parenthesized wrappers so initializers
 *  like `const config = {...} satisfies TypecadConfig` still parse. */
function unwrapExpr(node: ts.Expression): ts.Expression {
  let curr = node;
  for (;;) {
    if (ts.isAsExpression(curr) || ts.isTypeAssertionExpression(curr) || ts.isParenthesizedExpression(curr)) {
      curr = curr.expression;
      continue;
    }
    // satisfies is TS ≥4.9 — guard for older typings, then cast for .expression.
    const isSatisfies = (ts as any).isSatisfiesExpression as ((n: ts.Node) => boolean) | undefined;
    if (typeof isSatisfies === 'function' && isSatisfies(curr)) {
      curr = (curr as ts.SatisfiesExpression).expression;
      continue;
    }
    return curr;
  }
}

/** Property key as plain text — accepts both `target:` and `'target':` forms. */
function propName(prop: ts.ObjectLiteralElement): string | undefined {
  const name = (prop as any).name;
  if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) return name.text;
  return undefined;
}

/** String-literal (or plain template-literal) text, through as-cast wrappers. */
function stringLikeText(node: ts.Expression): string | undefined {
  const curr = unwrapExpr(node);
  return (ts.isStringLiteral(curr) || ts.isNoSubstitutionTemplateLiteral(curr))
    ? curr.text
    : undefined;
}

/** Numeric literal via Number() so hex (0x38), decimals, and separators parse
 *  correctly — parseInt(text, 10) silently corrupted hex values to 0. */
function numericValue(node: ts.Expression): number | undefined {
  const curr = unwrapExpr(node);
  if (ts.isNumericLiteral(curr)) return Number(curr.text);
  if (ts.isPrefixUnaryExpression(curr)
    && (curr.operator === ts.SyntaxKind.MinusToken || curr.operator === ts.SyntaxKind.PlusToken)
    && ts.isNumericLiteral(curr.operand)) {
    const magnitude = Number(curr.operand.text);
    return curr.operator === ts.SyntaxKind.MinusToken ? -magnitude : magnitude;
  }
  return undefined;
}

function boolValue(node: ts.Expression): boolean | undefined {
  const curr = unwrapExpr(node);
  if (curr.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (curr.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

export function parseConfigAST(configPath: string): RawConfig {
  const text = fs.readFileSync(configPath, 'utf8');
  const sf = ts.createSourceFile(configPath, text, ts.ScriptTarget.Latest, true);

  const result: RawConfig = {};

  for (const stmt of sf.statements) {
    // `const config: TypecadConfig = { ... };`
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        const init = decl.initializer ? unwrapExpr(decl.initializer) : undefined;
        if (init && ts.isObjectLiteralExpression(init)) {
          extractConfigProperties(init, result);
        }
      }
    }

    // `export default { ... };`
    if (ts.isExportAssignment(stmt)) {
      const expr = unwrapExpr(stmt.expression);
      if (ts.isObjectLiteralExpression(expr)) {
        extractConfigProperties(expr, result);
      }
    }
  }

  return result;
}

function extractConfigProperties(obj: ts.ObjectLiteralExpression, out: RawConfig): void {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = propName(prop);
    if (!name) continue;

    switch (name) {
      case 'target': {
        const v = stringLikeText(prop.initializer);
        if (v !== undefined) out.target = v;
        break;
      }
      case 'board': {
        const v = stringLikeText(prop.initializer);
        if (v !== undefined) out.board = v;
        break;
      }
      case 'mcu': {
        const v = stringLikeText(prop.initializer);
        if (v !== undefined) out.mcu = v;
        break;
      }
      case 'frameworkData': {
        const init = unwrapExpr(prop.initializer);
        if (ts.isObjectLiteralExpression(init)) {
          out.frameworkData = {};
          for (const fProp of init.properties) {
            if (ts.isPropertyAssignment(fProp) && propName(fProp) === 'buildTarget') {
              const v = stringLikeText(fProp.initializer);
              if (v !== undefined) out.frameworkData.buildTarget = v;
            }
          }
        }
        break;
      }
      case 'framework': {
        const v = stringLikeText(prop.initializer);
        if (v !== undefined) out.framework = v;
        break;
      }
      case 'toolchain': {
        const init = unwrapExpr(prop.initializer);
        if (ts.isObjectLiteralExpression(init)) {
          out.toolchain = {};
          for (const tProp of init.properties) {
            if (ts.isPropertyAssignment(tProp) && propName(tProp) === 'type') {
              const v = stringLikeText(tProp.initializer);
              if (v !== undefined) out.toolchain.type = v;
            }
          }
        }
        break;
      }
      case 'zephyr': {
        // Parse the zephyr section (kconfig, runner, cmakeArgs) as a generic
        // object so it can be passed through to the Zephyr toolchain.
        const init = unwrapExpr(prop.initializer);
        if (ts.isObjectLiteralExpression(init)) {
          out.zephyr = {};
          for (const zProp of init.properties) {
            if (!ts.isPropertyAssignment(zProp)) continue;
            const key = propName(zProp);
            if (!key) continue;
            const zInit = unwrapExpr(zProp.initializer);
            if (ts.isObjectLiteralExpression(zInit)) {
              // kconfig: { 'CONFIG_X': 'y' }
              const sub: Record<string, string> = {};
              for (const subProp of zInit.properties) {
                if (!ts.isPropertyAssignment(subProp)) continue;
                const subKey = propName(subProp);
                const v = stringLikeText(subProp.initializer);
                if (subKey !== undefined && v !== undefined) sub[subKey] = v;
              }
              (out.zephyr as Record<string, unknown>)[key] = sub;
            } else {
              const v = stringLikeText(zInit);
              if (v !== undefined) (out.zephyr as Record<string, unknown>)[key] = v;
            }
          }
        }
        break;
      }
      case 'test': {
        const init = unwrapExpr(prop.initializer);
        if (ts.isObjectLiteralExpression(init)) {
          out.test = extractTestConfig(init);
        }
        break;
      }
      case 'output': {
        const init = unwrapExpr(prop.initializer);
        if (ts.isObjectLiteralExpression(init)) {
          out.output = extractOutputConfig(init);
        }
        break;
      }
    }
  }
}

function extractTestConfig(obj: ts.ObjectLiteralExpression): Partial<TestConfig> {
  const result: Partial<TestConfig> = {};

  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = propName(prop);
    if (!name) continue;

    switch (name) {
      case 'port': {
        const v = stringLikeText(prop.initializer);
        if (v !== undefined) result.port = v;
        break;
      }
      case 'usb': {
        const init = unwrapExpr(prop.initializer);
        if (ts.isObjectLiteralExpression(init)) {
          const sub: Record<string, string> = {};
          for (const subProp of init.properties) {
            if (!ts.isPropertyAssignment(subProp)) continue;
            const subKey = propName(subProp);
            const v = stringLikeText(subProp.initializer);
            if (subKey !== undefined && v !== undefined) sub[subKey] = v;
          }
          if (sub.vid && sub.pid) {
            result.usb = { vid: sub.vid, pid: sub.pid, ...(sub.serial ? { serial: sub.serial } : {}) };
          }
        }
        break;
      }
      case 'baudRate': {
        const v = numericValue(prop.initializer);
        if (v !== undefined) result.baudRate = v;
        break;
      }
      case 'timeout': {
        const v = numericValue(prop.initializer);
        if (v !== undefined) result.timeout = v;
        break;
      }
      case 'serialOpenDelay': {
        const v = numericValue(prop.initializer);
        if (v !== undefined) result.serialOpenDelay = v;
        break;
      }
      case 'buildTarget': {
        const v = stringLikeText(prop.initializer);
        if (v !== undefined) result.buildTarget = v;
        break;
      }
      case 'resetAfterOpen': {
        const v = boolValue(prop.initializer);
        if (v !== undefined) result.resetAfterOpen = v;
        break;
      }
      case 'verbose': {
        const v = boolValue(prop.initializer);
        if (v !== undefined) result.verbose = v;
        break;
      }
      case 'board': {
        const v = stringLikeText(prop.initializer);
        if (v !== undefined) result.board = v;
        break;
      }
      case 'include':
      case 'exclude': {
        const init = unwrapExpr(prop.initializer);
        if (ts.isArrayLiteralExpression(init)) {
          const values = init.elements
            .map(el => stringLikeText(el))
            .filter((v): v is string => v !== undefined);
          if (name === 'include') result.include = values;
          else result.exclude = values;
        }
        break;
      }
    }
  }

  return result;
}

function extractOutputConfig(obj: ts.ObjectLiteralExpression): NonNullable<RawConfig['output']> {
  const result: NonNullable<RawConfig['output']> = {};
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = propName(prop);
    if (!name) continue;
    const v = stringLikeText(prop.initializer);
    if (v === undefined) continue;
    if (name === 'framework') result.framework = v;
    if (name === 'outDir') result.outDir = v;
  }
  return result;
}
