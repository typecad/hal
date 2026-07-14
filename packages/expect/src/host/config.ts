// ---------------------------------------------------------------------------
// @typecad/expect — Configuration loader
//
// Reads the `cuttlefish.config.ts` file to extract both the base transpiler
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
 * Load configuration from `cuttlefish.config.ts` in the given project root.
 *
 * Parses the config file via the TypeScript AST (no dynamic import) to
 * extract scalar properties — consistent with how the cuttlefish CLI does it.
 *
 * @param projectRoot  Absolute path to the project root.
 * @param overrides    CLI flag overrides for test config.
 */
export function loadConfig(
  projectRoot: string,
  overrides: Partial<TestConfig> = {},
): ResolvedConfig {
  const configPath = findConfigFile(projectRoot);
  if (!configPath) {
    throw new Error(
      `No cuttlefish.config.ts found in ${projectRoot}. ` +
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
    buildTarget: test.buildTarget ?? raw.frameworkData?.buildTarget ?? 'arduino:avr:uno',
    board: test.board ?? raw.board ?? '@typecad/board-arduino-uno',
    target: raw.target ?? 'avr',
    framework: raw.framework,
    projectRoot,
  };
}

// ---------------------------------------------------------------------------
// Internal — Config file discovery
// ---------------------------------------------------------------------------

function findConfigFile(projectRoot: string): string | undefined {
  const candidates = [
    path.join(projectRoot, 'cuttlefish.config.ts'),
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
  frameworkData?: { buildTarget?: string };
  framework?: string;
  test?: Partial<TestConfig>;
  output?: {
    framework?: string;
    optimize?: string;
    outDir?: string;
  };
  console?: {
    baudRate?: number;
  };
}

export function parseConfigAST(configPath: string): RawConfig {
  const text = fs.readFileSync(configPath, 'utf8');
  const sf = ts.createSourceFile(configPath, text, ts.ScriptTarget.Latest, true);

  const result: RawConfig = {};

  for (const stmt of sf.statements) {
    // `const config: CuttlefishConfig = { ... };`
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (decl.initializer && ts.isObjectLiteralExpression(decl.initializer)) {
          extractConfigProperties(decl.initializer, result);
        }
      }
    }

    // `export default { ... };`
    if (ts.isExportAssignment(stmt) && ts.isObjectLiteralExpression(stmt.expression)) {
      extractConfigProperties(stmt.expression, result);
    }
  }

  return result;
}

function extractConfigProperties(obj: ts.ObjectLiteralExpression, out: RawConfig): void {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;

    const name = prop.name.text;

    switch (name) {
      case 'target':
        if (ts.isStringLiteral(prop.initializer)) out.target = prop.initializer.text;
        break;
      case 'board':
        if (ts.isStringLiteral(prop.initializer)) out.board = prop.initializer.text;
        break;
      case 'frameworkData':
        if (ts.isObjectLiteralExpression(prop.initializer)) {
          out.frameworkData = {};
          for (const fProp of prop.initializer.properties) {
            if (ts.isPropertyAssignment(fProp) && ts.isIdentifier(fProp.name) && fProp.name.text === 'buildTarget') {
              if (ts.isStringLiteral(fProp.initializer)) out.frameworkData.buildTarget = fProp.initializer.text;
            }
          }
        }
        break;
      case 'framework':
        if (ts.isStringLiteral(prop.initializer)) out.framework = prop.initializer.text;
        break;
      case 'test':
        if (ts.isObjectLiteralExpression(prop.initializer)) {
          out.test = extractTestConfig(prop.initializer);
        }
        break;
      case 'output':
        if (ts.isObjectLiteralExpression(prop.initializer)) {
          out.output = extractOutputConfig(prop.initializer);
        }
        break;
      case 'console':
        if (ts.isObjectLiteralExpression(prop.initializer)) {
          out.console = extractConsoleConfig(prop.initializer);
        }
        break;
    }
  }
}

function extractTestConfig(obj: ts.ObjectLiteralExpression): Partial<TestConfig> {
  const result: Partial<TestConfig> = {};

  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;

    const name = prop.name.text;

    switch (name) {
      case 'port':
        if (ts.isStringLiteral(prop.initializer)) result.port = prop.initializer.text;
        break;
      case 'baudRate':
        if (ts.isNumericLiteral(prop.initializer)) result.baudRate = parseInt(prop.initializer.text, 10);
        break;
      case 'timeout':
        if (ts.isNumericLiteral(prop.initializer)) result.timeout = parseInt(prop.initializer.text, 10);
        break;
      case 'serialOpenDelay':
        if (ts.isNumericLiteral(prop.initializer)) result.serialOpenDelay = parseInt(prop.initializer.text, 10);
        break;
      case 'buildTarget':
        if (ts.isStringLiteral(prop.initializer)) result.buildTarget = prop.initializer.text;
        break;
      case 'resetAfterOpen':
        if (prop.initializer.kind === ts.SyntaxKind.TrueKeyword) result.resetAfterOpen = true;
        if (prop.initializer.kind === ts.SyntaxKind.FalseKeyword) result.resetAfterOpen = false;
        break;
      case 'board':
        if (ts.isStringLiteral(prop.initializer)) result.board = prop.initializer.text;
        break;
      case 'include':
        if (ts.isArrayLiteralExpression(prop.initializer)) {
          result.include = prop.initializer.elements
            .filter(ts.isStringLiteral)
            .map(el => el.text);
        }
        break;
      case 'exclude':
        if (ts.isArrayLiteralExpression(prop.initializer)) {
          result.exclude = prop.initializer.elements
            .filter(ts.isStringLiteral)
            .map(el => el.text);
        }
        break;
    }
  }

  return result;
}

function extractOutputConfig(obj: ts.ObjectLiteralExpression): NonNullable<RawConfig['output']> {
  const result: NonNullable<RawConfig['output']> = {};
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
    const name = prop.name.text;
    if (name === 'framework' && ts.isStringLiteral(prop.initializer)) result.framework = prop.initializer.text;
    if (name === 'optimize' && ts.isStringLiteral(prop.initializer)) result.optimize = prop.initializer.text;
    if (name === 'outDir' && ts.isStringLiteral(prop.initializer)) result.outDir = prop.initializer.text;
  }
  return result;
}

function extractConsoleConfig(obj: ts.ObjectLiteralExpression): NonNullable<RawConfig['console']> {
  const result: NonNullable<RawConfig['console']> = {};
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
    if (prop.name.text === 'baudRate' && ts.isNumericLiteral(prop.initializer)) {
      result.baudRate = parseInt(prop.initializer.text, 10);
    }
  }
  return result;
}
