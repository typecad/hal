// ---------------------------------------------------------------------------
// @typecad/expect — Compiler
//
// Wraps the cuttlefish transpiler + arduino-cli compile/upload cycle.
// Takes preprocessed TypeScript source, transpiles to C++, compiles, uploads.
// ---------------------------------------------------------------------------

import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { parseConfigAST } from './config.js';
import { checkArduinoEnv, type ArduinoEnvFailure } from '@typecad/arduino-cli';

// createRequire lets us use require() in an ESM module for the optional
// framework-zephyr dynamic import (avoids a hard dependency for Arduino users).
const require = createRequire(import.meta.url);

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

/** Format a check failure into the `error` field used by CompileResult/UploadResult. */
function formatEnvFailure(failure: ArduinoEnvFailure): string {
  const lines = [...failure.messages];
  if (failure.fixCommand) lines.push(`  Fix: ${failure.fixCommand}`);
  return lines.join('\n');
}

/**
 * Transpile preprocessed TypeScript source to a C++ Arduino sketch (or Zephyr
 * project). Writes the preprocessed source to a temp file, invokes the cuttlefish
 * transpiler, and returns the path to the generated .ino (Arduino) or .cpp
 * (Zephyr) entry file.
 */
export function transpileTestFile(
  preprocessedSource: string,
  originalFilePath: string,
  projectRoot: string,
  buildTarget: string,
  toolchainType: 'arduino-cli' | 'west' = 'arduino-cli',
  configPath?: string,
): CompileResult {
  // Create a build directory for this test file. Per-file directories are
  // used — arduino-cli compile has no incremental benefit from a shared dir.
  const baseName = path.basename(originalFilePath, '.test.ts').replace(/[^a-zA-Z0-9_]/g, '_');
  const buildDir = path.join(projectRoot, '.build', 'expect', baseName);

  try {
    // Fresh dir for every transpile.
    fs.rmSync(buildDir, { recursive: true, force: true });
    fs.mkdirSync(buildDir, { recursive: true });
  } catch {
    return { success: false, sketchDir: buildDir, sketchPath: '', output: '', error: `Failed to create build dir: ${buildDir}` };
  }

  const rewrittenSource = rewriteRelativeImports(preprocessedSource, originalFilePath, buildDir);

  // Write the preprocessed source as a .ts file
  const tsPath = path.join(buildDir, `${baseName}.ts`);
  fs.writeFileSync(tsPath, rewrittenSource, 'utf8');

  // Invoke the cuttlefish transpiler
  // We call it as a CLI command rather than importing to avoid coupling
  const cuttlefishCmd = resolveCuttlefishCmd(projectRoot);
  // Use build mode (run `cuttlefish build` from a build dir that holds its own
  // generated cuttlefish.config.ts) when the test source has relative imports
  // OR when an explicit configPath was passed. The latter matters because
  // direct-file mode discovers cuttlefish.config.ts from cwd (projectRoot),
  // which is the DEFAULT config — so a project with several target-specific
  // configs (e.g. tests/hardware/cuttlefish.config.ts vs ble-demo.config.ts)
  // would always transpile against the default. Build mode writes a config
  // derived from the chosen configPath into the build dir, so the right
  // board/MCU/target is used.
  const useBuildMode = hasRelativeImports(rewrittenSource) || !!configPath;

  if (useBuildMode) {
    writeBuildConfig(buildDir, projectRoot, path.basename(tsPath), buildTarget, configPath);
  }

  const result = spawnSync(
    process.execPath,
    useBuildMode
      ? [cuttlefishCmd, 'build', '--skip-type-check', '--force']
      : [cuttlefishCmd, tsPath, '--skip-type-check', '--force'],
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

  // Find the generated entry file (.ino for Arduino, .cpp for Zephyr)
  const outDir = findOutputDir(buildDir, baseName, projectRoot, toolchainType);
  const entryPath = findEntryFile(outDir, toolchainType);

  if (!entryPath) {
    const ext = toolchainType === 'west' ? '.cpp' : '.ino';
    return {
      success: false,
      sketchDir: outDir,
      sketchPath: '',
      output: transpileOutput,
      error: `No ${ext} file found in ${outDir} after transpilation`,
    };
  }

  return {
    success: true,
    sketchDir: path.dirname(entryPath),
    sketchPath: entryPath,
    output: transpileOutput,
  };
}

/**
 * Compile the sketch/project via the configured toolchain (arduino-cli or west).
 */
export function compileSketch(sketchDir: string, buildTarget: string, framework?: string, toolchainType: 'arduino-cli' | 'west' = 'arduino-cli', zephyrConfig?: Record<string, unknown>): CompileResult {
  if (toolchainType === 'west') {
    return compileWestProject(sketchDir, buildTarget, zephyrConfig);
  }
  return compileArduinoSketch(sketchDir, buildTarget);
}

/** Compile via arduino-cli. */
function compileArduinoSketch(sketchDir: string, buildTarget: string): CompileResult {
  // Hard gate: verify arduino-cli + core before spawning.
  {
    const gate = checkArduinoEnv(buildTarget);
    if (!gate.ok) {
      const message = formatEnvFailure(gate);
      return { success: false, sketchDir, sketchPath: '', output: message, error: message };
    }
  }
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
 * Upload the compiled sketch/project to the board via the configured toolchain.
 */
export function uploadSketch(
  sketchDir: string,
  buildTarget: string,
  port: string,
  framework?: string,
  toolchainType: 'arduino-cli' | 'west' = 'arduino-cli',
  zephyrConfig?: Record<string, unknown>,
): UploadResult {
  if (toolchainType === 'west') {
    return uploadWestProject(sketchDir, buildTarget, port, zephyrConfig);
  }
  return uploadArduinoSketch(sketchDir, buildTarget, port);
}

/** Upload via arduino-cli. */
function uploadArduinoSketch(
  sketchDir: string,
  buildTarget: string,
  port: string,
): UploadResult {
  // Hard gate: verify arduino-cli + core before spawning.
  {
    const gate = checkArduinoEnv(buildTarget);
    if (!gate.ok) {
      const message = formatEnvFailure(gate);
      return { success: false, output: message, error: message };
    }
  }
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
// Zephyr (west) toolchain
// ---------------------------------------------------------------------------

/**
 * Compile a Zephyr project via `west build`. The Zephyr Toolchain (from
 * @typecad/framework-zephyr) handles west discovery, ZEPHYR_BASE, scaffolding,
 * and the board target. We call it via dynamic import to avoid a hard
 * dependency on framework-zephyr (the Arduino path doesn't need it).
 */
function compileWestProject(sketchDir: string, buildTarget: string, zephyrConfig?: Record<string, unknown>): CompileResult {
  // sketchDir for Zephyr is the project root containing src/, app/, build/.
  // The transpiler emits src/src.cpp; the west project root is the parent of src/.
  const srcDir = path.join(sketchDir, 'src');
  const projectRoot = fs.existsSync(srcDir) ? sketchDir : path.dirname(sketchDir);
  const sourcePath = fs.existsSync(path.join(srcDir, 'src.cpp'))
    ? path.join(srcDir, 'src.cpp')
    : path.join(sketchDir, 'src.cpp');
  const outputDir = fs.existsSync(srcDir) ? srcDir : sketchDir;

  try {
    // Dynamic import — framework-zephyr is an optional dependency (only present
    // for Zephyr projects). The Toolchain object has compile()/upload().
    const mod = require('@typecad/framework-zephyr');
    const Toolchain = mod.Toolchain;
    if (!Toolchain || typeof Toolchain.compile !== 'function') {
      return { success: false, sketchDir, sketchPath: '', output: '', error: '@typecad/framework-zephyr did not export a usable Toolchain.compile().' };
    }
    const result = Toolchain.compile({
      outputDir,
      sourcePath,
      buildTarget,
      zephyrConfig,
    });
    return {
      success: result.success,
      sketchDir: projectRoot,
      sketchPath: sourcePath,
      output: result.output,
      error: result.success ? undefined : `west build failed:\n${result.output}`,
    };
  } catch (e) {
    return { success: false, sketchDir, sketchPath: '', output: '', error: `Failed to compile via west: ${(e as Error).message}` };
  }
}

/**
 * Upload (flash) a Zephyr project via `west flash`. For ESP32 boards, west
 * uses the esptool runner; for nRF boards, nrfjprog. The port is forwarded.
 */
function uploadWestProject(sketchDir: string, buildTarget: string, port: string, zephyrConfig?: Record<string, unknown>): UploadResult {
  const srcDir = path.join(sketchDir, 'src');
  const projectRoot = fs.existsSync(srcDir) ? sketchDir : path.dirname(sketchDir);
  const sourcePath = fs.existsSync(path.join(srcDir, 'src.cpp'))
    ? path.join(srcDir, 'src.cpp')
    : path.join(sketchDir, 'src.cpp');
  const outputDir = fs.existsSync(srcDir) ? srcDir : sketchDir;

  try {
    const mod = require('@typecad/framework-zephyr');
    const Toolchain = mod.Toolchain;
    if (!Toolchain || typeof Toolchain.upload !== 'function') {
      return { success: false, output: '', error: '@typecad/framework-zephyr did not export a usable Toolchain.upload().' };
    }
    const result = Toolchain.upload({
      outputDir,
      sourcePath,
      buildTarget,
      port,
      zephyrConfig,
    });
    return {
      success: result.success,
      output: result.output,
      error: result.success ? undefined : `west flash failed:\n${result.output}`,
    };
  } catch (e) {
    return { success: false, output: '', error: `Failed to flash via west: ${(e as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function resolveCuttlefishCmd(projectRoot: string): string {
  // Try to find cuttlefish CLI in the monorepo (current dir and parent dirs).
  // We prefer the JS entry point over the .bin shims because the shell wrapper
  // (no extension) cannot be passed to `node process.execPath` on Windows, and
  // invoking it via the shell would require platform-specific handling.
  let searchDir = projectRoot;
  for (let i = 0; i < 5; i++) {
    const candidates = [
      path.join(searchDir, 'packages', 'cuttlefish', 'dist', 'cli.js'),
      path.join(searchDir, 'node_modules', '@typecad', 'cuttlefish', 'dist', 'cli.js'),
      path.join(searchDir, 'node_modules', 'cuttlefish', 'dist', 'cli.js'),
    ];

    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }

    const parent = path.dirname(searchDir);
    if (parent === searchDir) break; // reached root
    searchDir = parent;
  }

  // Fallback: assume it's on PATH
  return 'cuttlefish';
}

function findOutputDir(buildDir: string, baseName: string, projectRoot: string, toolchainType: 'arduino-cli' | 'west' = 'arduino-cli'): string {
  // The cuttlefish transpiler writes output next to the source by default,
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
    if (fs.existsSync(c) && hasEntryFile(c, toolchainType)) return c;
  }

  // Last resort: walk the buildDir tree recursively to find any entry file
  const found = findEntryFileRecursive(buildDir, toolchainType);
  if (found) return path.dirname(found);

  return buildDir;
}

/** Check for a .ino (Arduino) or .cpp (Zephyr) entry file in a directory. */
function hasEntryFile(dir: string, toolchainType: 'arduino-cli' | 'west' = 'arduino-cli'): boolean {
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).some(f => isEntryFileName(f, toolchainType));
}

/** True if the filename is a valid entry file for the toolchain. */
function isEntryFileName(name: string, toolchainType: 'arduino-cli' | 'west'): boolean {
  if (toolchainType === 'west') {
    return name.endsWith('.cpp') || name.endsWith('.cc');
  }
  return name.endsWith('.ino') || name.endsWith('.cc');
}

/** Find the entry file (.ino for Arduino, .cpp for Zephyr) in a directory. */
function findEntryFile(dir: string, toolchainType: 'arduino-cli' | 'west' = 'arduino-cli'): string | undefined {
  if (!fs.existsSync(dir)) return undefined;
  for (const entry of fs.readdirSync(dir)) {
    if (isEntryFileName(entry, toolchainType)) {
      return path.join(dir, entry);
    }
  }
  // For Zephyr, the entry may be in a src/ subdirectory
  if (toolchainType === 'west') {
    const srcDir = path.join(dir, 'src');
    if (fs.existsSync(srcDir)) {
      for (const entry of fs.readdirSync(srcDir)) {
        if (isEntryFileName(entry, toolchainType)) {
          return path.join(srcDir, entry);
        }
      }
    }
  }
  return undefined;
}

function findEntryFileRecursive(dir: string, toolchainType: 'arduino-cli' | 'west' = 'arduino-cli'): string | undefined {
  if (!fs.existsSync(dir)) return undefined;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (isEntryFileName(entry.name, toolchainType)) {
      return path.join(dir, entry.name);
    }
    if (entry.isDirectory()) {
      const result = findEntryFileRecursive(path.join(dir, entry.name), toolchainType);
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

function writeBuildConfig(buildDir: string, projectRoot: string, entryFileName: string, buildTarget: string, configPath?: string): void {
  // Resolve the source config: an explicit --config path wins; otherwise fall
  // back to cuttlefish.config.ts in the project root. The transpile runs from
  // buildDir, so we inline the scalar fields the cuttlefish transpiler needs
  // (target/board/mcu/framework/buildTarget/toolchain/zephyr) into a generated
  // cuttlefish.config.ts there — the config loader can't evaluate spreads or
  // relative imports, and discovery from buildDir would find no config.
  const baseConfigPath = configPath ?? path.join(projectRoot, 'cuttlefish.config.ts');
  const buildConfigPath = path.join(buildDir, 'cuttlefish.config.ts');

  if (fs.existsSync(baseConfigPath)) {
    // Parse base config via AST to extract scalar values, then inline them.
    // This avoids spreads (...baseConfig) which the config loader cannot evaluate.
    const baseValues = parseConfigAST(baseConfigPath);
    const lines = [
      `import type { CuttlefishConfig } from '@typecad/hal';`,
      '',
      'const config: CuttlefishConfig = {',
      `  entry: './${entryFileName}',`,
    ];
    if (baseValues.target) lines.push(`  target: '${baseValues.target}',`);
    if (baseValues.board) lines.push(`  board: '${baseValues.board}',`);
    if (baseValues.mcu) lines.push(`  mcu: '${baseValues.mcu}',`);
    if (baseValues.framework) lines.push(`  framework: '${baseValues.framework}',`);
    if (baseValues.frameworkData?.buildTarget) lines.push(`  frameworkData: { buildTarget: '${baseValues.frameworkData.buildTarget}' },`);
    if (baseValues.toolchain?.type) lines.push(`  toolchain: { type: '${baseValues.toolchain.type}' },`);

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

    // Pass the zephyr section (kconfig, runner) through verbatim — the Zephyr
    // toolchain reads runner from it (e.g. zephyr.runner: 'uf2'). Serialize the
    // parsed object as a minimal object literal (string values only; sufficient
    // for the scalar fields the toolchain reads).
    if (baseValues.zephyr && Object.keys(baseValues.zephyr).length > 0) {
      const parts = Object.entries(baseValues.zephyr)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join(', ');
      lines.push(`  zephyr: { ${parts} },`);
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
      `import type { CuttlefishConfig } from '@typecad/hal';`,
      '',
      'const config: CuttlefishConfig = {',
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
