// ---------------------------------------------------------------------------
// @typehal/expect — Compiler
//
// Wraps the typehal transpiler + arduino-cli compile/upload cycle.
// Takes preprocessed TypeScript source, transpiles to C++, compiles, uploads.
// ---------------------------------------------------------------------------

import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseConfigAST } from './config';

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
 * Writes the preprocessed source to a temp file, invokes the typehal
 * transpiler, and returns the path to the generated .ino file.
 */
export function transpileTestFile(
  preprocessedSource: string,
  originalFilePath: string,
  projectRoot: string,
  buildTarget: string,
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

  // Invoke the typehal transpiler
  // We call it as a CLI command rather than importing to avoid coupling
  const typehalCmd = resolveTypehalCmd(projectRoot);
  const useBuildMode = hasRelativeImports(rewrittenSource);

  if (useBuildMode) {
    writeBuildConfig(buildDir, projectRoot, path.basename(tsPath), buildTarget);
  }

  const result = spawnSync(
    process.execPath,
    useBuildMode
      ? [typehalCmd, 'build', '--skip-type-check', '--force']
      : [typehalCmd, tsPath, '--skip-type-check', '--force'],
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
export function compileSketch(sketchDir: string, buildTarget: string): CompileResult {
  const result = spawnSync(
    'arduino-cli',
    ['compile', '--fqbn', buildTarget, sketchDir],
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
  buildTarget: string,
  port: string,
): UploadResult {
  const result = spawnSync(
    'arduino-cli',
    ['upload', '--fqbn', buildTarget, '--port', port, sketchDir],
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

function resolveTypehalCmd(projectRoot: string): string {
  // Try to find typehal CLI in the monorepo (current dir and parent dirs)
  let searchDir = projectRoot;
  for (let i = 0; i < 5; i++) {
    const candidates = [
      path.join(searchDir, 'packages', 'transpiler', 'dist', 'cli.js'),
      path.join(searchDir, 'node_modules', '.bin', 'typehal'),
      path.join(searchDir, 'node_modules', 'typehal', 'dist', 'cli.js'),
    ];

    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }

    const parent = path.dirname(searchDir);
    if (parent === searchDir) break; // reached root
    searchDir = parent;
  }

  // Fallback: assume it's on PATH
  return 'typehal';
}

function findOutputDir(buildDir: string, baseName: string, projectRoot: string): string {
  // The typehal transpiler writes output next to the source by default,
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

function writeBuildConfig(buildDir: string, projectRoot: string, entryFileName: string, buildTarget: string): void {
  const baseConfigPath = path.join(projectRoot, 'typehal.config.ts');
  const buildConfigPath = path.join(buildDir, 'typehal.config.ts');

  if (fs.existsSync(baseConfigPath)) {
    // Parse base config via AST to extract scalar values, then inline them.
    // This avoids spreads (...baseConfig) which the config loader cannot evaluate.
    const baseValues = parseConfigAST(baseConfigPath);
    const lines = [
      `import type { TypehalConfig } from '@typehal/core';`,
      '',
      'const config: TypehalConfig = {',
      `  entry: './${entryFileName}',`,
    ];
    if (baseValues.target) lines.push(`  target: '${baseValues.target}',`);
    if (baseValues.board) lines.push(`  board: '${baseValues.board}',`);
    if (baseValues.framework) lines.push(`  framework: '${baseValues.framework}',`);
    if (baseValues.frameworkData?.buildTarget) lines.push(`  frameworkData: { buildTarget: '${baseValues.frameworkData.buildTarget}' },`);

    lines.push('  output: {');
    if (baseValues.output?.framework) lines.push(`    framework: '${baseValues.output?.framework}',`);
    if (baseValues.output?.optimize) lines.push(`    optimize: '${baseValues.output?.optimize}',`);
    lines.push(`    outDir: './out',`);
    lines.push('  },');

    if (baseValues.console?.baudRate) {
      lines.push('  console: {');
      lines.push(`    baudRate: ${baseValues.console?.baudRate},`);
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
      `import type { TypehalConfig } from '@typehal/core';`,
      '',
      'const config: TypehalConfig = {',
      `  entry: './${entryFileName}',`,
      `  target: 'avr',`,
      `  frameworkData: { buildTarget: '${buildTarget}' },`,
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
