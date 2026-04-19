// ---------------------------------------------------------------------------
// @typecode/expect — Compiler
//
// Wraps the typecode transpiler + arduino-cli compile/upload cycle.
// Takes preprocessed TypeScript source, transpiles to C++, compiles, uploads.
// ---------------------------------------------------------------------------

import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CompileResult {
  success: boolean;
  sketchDir: string;
  sketchPath: string;
  output: string;
  error?: string;
}

export interface UploadResult {
  success: boolean;
  output: string;
  error?: string;
}

/**
 * Transpile preprocessed TypeScript source to a C++ Arduino sketch.
 *
 * Writes the preprocessed source to a temp file, invokes the typecode
 * transpiler, and returns the path to the generated .ino file.
 */
export function transpileTestFile(
  preprocessedSource: string,
  originalFilePath: string,
  projectRoot: string,
  fqbn: string,
): CompileResult {
  // Create a build directory for this test file
  const baseName = path.basename(originalFilePath, '.test.ts').replace(/[^a-zA-Z0-9_]/g, '_');
  const buildDir = path.join(projectRoot, '.build', 'expect', baseName);

  try {
    fs.rmSync(buildDir, { recursive: true, force: true });
    fs.mkdirSync(buildDir, { recursive: true });
  } catch {
    return { success: false, sketchDir: buildDir, sketchPath: '', output: '', error: `Failed to create build dir: ${buildDir}` };
  }

  const rewrittenSource = rewriteRelativeImports(preprocessedSource, originalFilePath, buildDir);

  // Write the preprocessed source as a .ts file
  const tsPath = path.join(buildDir, `${baseName}.ts`);
  fs.writeFileSync(tsPath, rewrittenSource, 'utf8');

  // Invoke the typecode transpiler
  // We call it as a CLI command rather than importing to avoid coupling
  const typecodeCmd = resolveTypecodeCmd(projectRoot);
  const useBuildMode = hasRelativeImports(rewrittenSource);

  if (useBuildMode) {
    writeBuildConfig(buildDir, projectRoot, path.basename(tsPath), fqbn);
  }

  const result = spawnSync(
    process.execPath,
    useBuildMode
      ? [typecodeCmd, 'build', '--skip-type-check', '--force']
      : [typecodeCmd, tsPath, '--skip-type-check', '--force'],
    {
      encoding: 'utf8',
      cwd: useBuildMode ? buildDir : projectRoot,
      timeout: 60000,
      env: { ...process.env },
    },
  );

  const transpileOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();

  if (result.status !== 0) {
    return {
      success: false,
      sketchDir: buildDir,
      sketchPath: '',
      output: transpileOutput,
      error: `Transpilation failed:\n${transpileOutput}`,
    };
  }

  // Find the generated .ino file
  const outDir = findOutputDir(buildDir, baseName, projectRoot);
  const inoPath = findInoFile(outDir);

  if (!inoPath) {
    return {
      success: false,
      sketchDir: outDir,
      sketchPath: '',
      output: transpileOutput,
      error: `No .ino file found in ${outDir} after transpilation`,
    };
  }

  return {
    success: true,
    sketchDir: path.dirname(inoPath),
    sketchPath: inoPath,
    output: transpileOutput,
  };
}

/**
 * Compile the Arduino sketch using arduino-cli.
 */
export function compileSketch(sketchDir: string, fqbn: string): CompileResult {
  const result = spawnSync(
    'arduino-cli',
    ['compile', '--fqbn', fqbn, sketchDir],
    { encoding: 'utf8', timeout: 120000 },
  );

  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();

  return {
    success: result.status === 0,
    sketchDir,
    sketchPath: '',
    output,
    error: result.status !== 0 ? `Compilation failed:\n${output}` : undefined,
  };
}

/**
 * Upload the compiled sketch to the board.
 */
export function uploadSketch(
  sketchDir: string,
  fqbn: string,
  port: string,
): UploadResult {
  const result = spawnSync(
    'arduino-cli',
    ['upload', '--fqbn', fqbn, '--port', port, sketchDir],
    { encoding: 'utf8', timeout: 60000 },
  );

  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();

  return {
    success: result.status === 0,
    output,
    error: result.status !== 0 ? `Upload failed:\n${output}` : undefined,
  };
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function resolveTypecodeCmd(projectRoot: string): string {
  // Try to find typecode CLI in the monorepo (current dir and parent dirs)
  let searchDir = projectRoot;
  for (let i = 0; i < 5; i++) {
    const candidates = [
      path.join(searchDir, 'packages', 'cli', 'dist', 'cli.js'),
      path.join(searchDir, 'node_modules', '.bin', 'typecode'),
      path.join(searchDir, 'node_modules', 'typecode', 'dist', 'cli.js'),
    ];

    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }

    const parent = path.dirname(searchDir);
    if (parent === searchDir) break; // reached root
    searchDir = parent;
  }

  // Fallback: assume it's on PATH
  return 'typecode';
}

function findOutputDir(buildDir: string, baseName: string, projectRoot: string): string {
  // The typecode transpiler writes output next to the source by default,
  // or to the configured outDir.  Check common locations.
  const candidates = [
    buildDir,
    path.join(buildDir, baseName),
    path.join(buildDir, 'out', baseName),
    path.join(buildDir, 'out'),
    path.join(projectRoot, 'out'),
    path.join(projectRoot, '.build', 'expect', baseName, baseName),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c) && hasInoFile(c)) return c;
  }

  // Last resort: walk the buildDir tree recursively to find any .ino
  const found = findInoFileRecursive(buildDir);
  if (found) return path.dirname(found);

  return buildDir;
}

function hasInoFile(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).some(f => f.endsWith('.ino'));
}

function findInoFile(dir: string): string | undefined {
  if (!fs.existsSync(dir)) return undefined;
  for (const entry of fs.readdirSync(dir)) {
    if (entry.endsWith('.ino')) {
      return path.join(dir, entry);
    }
  }
  return undefined;
}

function findInoFileRecursive(dir: string): string | undefined {
  if (!fs.existsSync(dir)) return undefined;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.endsWith('.ino')) {
      return path.join(dir, entry.name);
    }
    if (entry.isDirectory()) {
      const result = findInoFileRecursive(path.join(dir, entry.name));
      if (result) return result;
    }
  }
  return undefined;
}

function hasRelativeImports(source: string): boolean {
  return /from\s+['"]\.\.?\//.test(source);
}

function rewriteRelativeImports(source: string, originalFilePath: string, buildDir: string): string {
  const originalDir = path.dirname(originalFilePath);

  return source.replace(/from\s+(['"])(\.\.?\/[^'"]+)\1/g, (_match, quote: string, specifier: string) => {
    const resolvedPath = path.resolve(originalDir, specifier);
    let relativePath = path.relative(buildDir, resolvedPath).replace(/\\/g, '/');
    if (!relativePath.startsWith('.')) {
      relativePath = `./${relativePath}`;
    }
    return `from ${quote}${relativePath}${quote}`;
  });
}

function writeBuildConfig(buildDir: string, projectRoot: string, entryFileName: string, fqbn: string): void {
  const baseConfigPath = path.join(projectRoot, 'typecode.config.ts');
  const buildConfigPath = path.join(buildDir, 'typecode.config.ts');

  if (fs.existsSync(baseConfigPath)) {
    // Parse base config via AST to extract scalar values, then inline them.
    // This avoids spreads (...baseConfig) which the config loader cannot evaluate.
    const baseValues = parseConfigScalars(baseConfigPath);
    const lines = [
      `import type { TypecodeConfig } from '@typecode/core';`,
      '',
      'const config: TypecodeConfig = {',
      `  entry: './${entryFileName}',`,
    ];
    if (baseValues.target) lines.push(`  target: '${baseValues.target}',`);
    if (baseValues.board) lines.push(`  board: '${baseValues.board}',`);
    if (baseValues.framework) lines.push(`  framework: '${baseValues.framework}',`);
    if (baseValues.fqbn) lines.push(`  fqbn: '${baseValues.fqbn}',`);

    lines.push('  output: {');
    if (baseValues.outputFramework) lines.push(`    framework: '${baseValues.outputFramework}',`);
    if (baseValues.outputOptimize) lines.push(`    optimize: '${baseValues.outputOptimize}',`);
    lines.push(`    outDir: './out',`);
    lines.push('  },');

    if (baseValues.consoleBaudRate) {
      lines.push('  console: {');
      lines.push(`    baudRate: ${baseValues.consoleBaudRate},`);
      lines.push('  },');
    }

    lines.push('};');
    lines.push('');
    lines.push('export default config;');
    lines.push('');

    fs.writeFileSync(buildConfigPath, lines.join('\n'), 'utf8');
    return;
  }

  fs.writeFileSync(
    buildConfigPath,
    [
      `import type { TypecodeConfig } from '@typecode/core';`,
      '',
      'const config: TypecodeConfig = {',
      `  entry: './${entryFileName}',`,
      `  target: 'avr',`,
      `  fqbn: '${fqbn}',`,
      '  output: {',
      `    framework: 'arduino',`,
      `    outDir: './out',`,
      '  },',
      '};',
      '',
      'export default config;',
      '',
    ].join('\n'),
    'utf8',
  );
}

/**
 * Simple AST-based extraction of scalar values from a typecode.config.ts file.
 * Walks the default-exported object literal and collects string/number/boolean values.
 */
function parseConfigScalars(configPath: string): Record<string, string | number | undefined> {
  const ts = require('typescript');
  const sourceText = fs.readFileSync(configPath, 'utf-8');
  const sourceFile = ts.createSourceFile(configPath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  // Find the exported config object literal
  let configObject: any = undefined;
  for (const stmt of sourceFile.statements) {
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals && ts.isObjectLiteralExpression(stmt.expression)) {
      configObject = stmt.expression;
      break;
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer && ts.isObjectLiteralExpression(decl.initializer)) {
          // Check if this variable is the default export
          for (const s2 of sourceFile.statements) {
            if (ts.isExportAssignment(s2) && ts.isIdentifier(s2.expression) && s2.expression.text === decl.name.text) {
              configObject = decl.initializer;
              break;
            }
          }
          if (configObject) break;
        }
      }
      if (configObject) break;
    }
  }

  const flat: Record<string, string | number | undefined> = {};
  if (!configObject) return flat;

  function walk(obj: any, prefix: string): void {
    for (const prop of obj.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const key = ts.isIdentifier(prop.name) ? prop.name.text : undefined;
      if (!key) continue;
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (ts.isObjectLiteralExpression(prop.initializer)) {
        walk(prop.initializer, fullKey);
      } else {
        const val = prop.initializer;
        if (ts.isStringLiteral(val) || ts.isNoSubstitutionTemplateLiteral(val)) {
          flat[fullKey] = val.text;
        } else if (ts.isNumericLiteral(val)) {
          flat[fullKey] = Number(val.text);
        }
      }
    }
  }

  walk(configObject, '');

  return {
    target: flat['target'] as string | undefined,
    board: flat['board'] as string | undefined,
    framework: flat['framework'] as string | undefined,
    fqbn: flat['fqbn'] as string | undefined,
    outputFramework: flat['output.framework'] as string | undefined,
    outputOptimize: flat['output.optimize'] as string | undefined,
    consoleBaudRate: flat['console.baudRate'] as number | undefined,
  };
}
