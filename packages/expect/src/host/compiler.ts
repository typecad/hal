// ---------------------------------------------------------------------------
// @typecad/expect — Compiler
//
// Wraps the cuttlefish transpiler + west compile/flash cycle. Takes
// preprocessed TypeScript source, transpiles to C++, compiles, uploads.
// ---------------------------------------------------------------------------

import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { parseConfigAST } from './config.js';

// createRequire lets us use require() in an ESM module for the optional
// framework-zephyr dynamic import.
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CompileResult {
  success: boolean;
  projectDir: string;
  sourcePath: string;
  output: string;
  error?: string;
}

export interface UploadResult {
  success: boolean;
  output: string;
  error?: string;
}

/**
 * Transpile preprocessed TypeScript source to a C++ Zephyr project. Writes
 * the preprocessed source to a temp file, invokes the cuttlefish transpiler,
 * and returns the path to the generated .cpp entry file.
 */
export function transpileTestFile(
  preprocessedSource: string,
  originalFilePath: string,
  projectRoot: string,
  buildTarget: string,
  configPath?: string,
): CompileResult {
  // Create a build directory for this test file. Per-file directories are
  // used — west builds have no incremental benefit from a shared dir.
  const baseName = path.basename(originalFilePath, '.test.ts').replace(/[^a-zA-Z0-9_]/g, '_');
  const buildDir = path.join(projectRoot, '.build', 'expect', baseName);

  try {
    // Fresh dir for every transpile.
    fs.rmSync(buildDir, { recursive: true, force: true });
    fs.mkdirSync(buildDir, { recursive: true });
  } catch {
    return { success: false, projectDir: buildDir, sourcePath: '', output: '', error: `Failed to create build dir: ${buildDir}` };
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
  // configs (e.g. packages/hal/tests/network/cuttlefish.config.ts vs ble-demo.config.ts)
  // would always transpile against the default. Build mode writes a config
  // derived from the chosen configPath into the build dir, so the right
  // board/MCU/target is used.
  const useBuildMode = hasRelativeImports(rewrittenSource) || !!configPath;

  if (useBuildMode) {
    writeBuildConfig(buildDir, projectRoot, path.basename(tsPath), buildTarget, configPath);
  }

  const result = spawnSync(
    process.execPath,
    // Explicit heap headroom for the transpile child. The steady-state
    // transpile peaks well under 1 GB, but Node's default old-space cap
    // (~4 GB on large-RAM machines) has been hit transiently — a GC storm
    // then kills the child with "JavaScript heap out of memory" and fails
    // the whole test file. Dedicated headroom makes a spike recoverable.
    [
      '--max-old-space-size=6144',
      cuttlefishCmd,
      ...(useBuildMode
        ? ['build', '--skip-type-check', '--force']
        : [tsPath, '--skip-type-check', '--force']),
    ],
    {
      encoding: 'utf8',
      cwd: useBuildMode ? buildDir : projectRoot,
      timeout: 120000,
      env: { ...process.env },
    },
  );

  const transpileOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();

  if (result.status !== 0) {
    // Surface spawn-level errors (EMFILE/ENOENT from a degraded runner —
    // e.g. after serial-handle leaks): spawnSync reports them on .error
    // with a null status and EMPTY stdout/stderr, which previously masked
    // the cause as a bare "Transpilation failed:".
    const spawnErr = result.error ? ` (spawn error: ${result.error.message})` : '';
    return {
      success: false,
      projectDir: buildDir,
      sourcePath: '',
      output: transpileOutput,
      error: `Transpilation failed${spawnErr}:\n${transpileOutput}`,
    };
  }

  // Find the generated entry file (.cpp for Zephyr)
  const outDir = findOutputDir(buildDir, baseName, projectRoot);
  const entryPath = findEntryFile(outDir);

  if (!entryPath) {
    return {
      success: false,
      projectDir: outDir,
      sourcePath: '',
      output: transpileOutput,
      error: `No .cpp file found in ${outDir} after transpilation`,
    };
  }

  return {
    success: true,
    projectDir: path.dirname(entryPath),
    sourcePath: entryPath,
    output: transpileOutput,
  };
}

/**
 * Compile the Zephyr project via `west build` (through the Zephyr Toolchain).
 */
export function compileProgram(projectDir: string, buildTarget: string, zephyrConfig?: Record<string, unknown>, consoleConfig?: Record<string, unknown>): CompileResult {
  return compileWestProject(projectDir, buildTarget, zephyrConfig, consoleConfig);
}

/**
 * Upload the compiled project to the board via `west flash` (through the
 * Zephyr Toolchain).
 */
export function uploadProgram(
  projectDir: string,
  buildTarget: string,
  port: string,
  zephyrConfig?: Record<string, unknown>,
): UploadResult {
  return uploadWestProject(projectDir, buildTarget, port, zephyrConfig);
}

// ---------------------------------------------------------------------------
// Zephyr (west) toolchain
// ---------------------------------------------------------------------------

/**
 * Compile a Zephyr project via `west build`. The Zephyr Toolchain (from
 * @typecad/framework-zephyr) handles west discovery, ZEPHYR_BASE, scaffolding,
 * and the board target. We call it via dynamic import so expect only gains
 * the dependency when framework-zephyr is installed.
 */
function compileWestProject(projectDir: string, buildTarget: string, zephyrConfig?: Record<string, unknown>, consoleConfig?: Record<string, unknown>): CompileResult {
  // projectDir for Zephyr is the project root containing src/, app/, build/.
  // The transpiler emits src/src.cpp; the west project root is the parent of src/.
  const srcDir = path.join(projectDir, 'src');
  const projectRoot = fs.existsSync(srcDir) ? projectDir : path.dirname(projectDir);
  const sourcePath = fs.existsSync(path.join(srcDir, 'src.cpp'))
    ? path.join(srcDir, 'src.cpp')
    : path.join(projectDir, 'src.cpp');
  const outputDir = fs.existsSync(srcDir) ? srcDir : projectDir;

  try {
    // Dynamic import — framework-zephyr is an optional dependency (only present
    // for Zephyr projects). The Toolchain object has compile()/upload().
    const mod = require('@typecad/framework-zephyr');
    const Toolchain = mod.Toolchain;
    if (!Toolchain || typeof Toolchain.compile !== 'function') {
      return { success: false, projectDir, sourcePath: '', output: '', error: '@typecad/framework-zephyr did not export a usable Toolchain.compile().' };
    }
    const result = Toolchain.compile({
      outputDir,
      sourcePath,
      buildTarget,
      zephyrConfig,
      consoleConfig,
    });
    return {
      success: result.success,
      projectDir: projectRoot,
      sourcePath: sourcePath,
      output: result.output,
      error: result.success ? undefined : `west build failed:\n${result.output}`,
    };
  } catch (e) {
    return { success: false, projectDir, sourcePath: '', output: '', error: `Failed to compile via west: ${(e as Error).message}` };
  }
}

/**
 * Upload (flash) a Zephyr project via `west flash`. For ESP32 boards, west
 * uses the esptool runner; for nRF boards, nrfjprog. The port is forwarded.
 */
function uploadWestProject(projectDir: string, buildTarget: string, port: string, zephyrConfig?: Record<string, unknown>): UploadResult {
  const srcDir = path.join(projectDir, 'src');
  const projectRoot = fs.existsSync(srcDir) ? projectDir : path.dirname(projectDir);
  const sourcePath = fs.existsSync(path.join(srcDir, 'src.cpp'))
    ? path.join(srcDir, 'src.cpp')
    : path.join(projectDir, 'src.cpp');
  const outputDir = fs.existsSync(srcDir) ? srcDir : projectDir;

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

function findOutputDir(buildDir: string, baseName: string, projectRoot: string): string {
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
    if (fs.existsSync(c) && hasEntryFile(c)) return c;
  }

  // Last resort: walk the buildDir tree recursively to find any entry file
  const found = findEntryFileRecursive(buildDir);
  if (found) return path.dirname(found);

  return buildDir;
}

/** Check for a .cpp entry file in a directory. */
function hasEntryFile(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).some(f => isEntryFileName(f));
}

/** True if the filename is a valid entry file (.cpp/.cc). */
function isEntryFileName(name: string): boolean {
  return name.endsWith('.cpp') || name.endsWith('.cc');
}

/** Find the entry .cpp file in a directory (or its src/ subdirectory). */
function findEntryFile(dir: string): string | undefined {
  if (!fs.existsSync(dir)) return undefined;
  for (const entry of fs.readdirSync(dir)) {
    if (isEntryFileName(entry)) {
      return path.join(dir, entry);
    }
  }
  // The entry may be in a src/ subdirectory
  const srcDir = path.join(dir, 'src');
  if (fs.existsSync(srcDir)) {
    for (const entry of fs.readdirSync(srcDir)) {
      if (isEntryFileName(entry)) {
        return path.join(srcDir, entry);
      }
    }
  }
  return undefined;
}

function findEntryFileRecursive(dir: string): string | undefined {
  if (!fs.existsSync(dir)) return undefined;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (isEntryFileName(entry.name)) {
      return path.join(dir, entry.name);
    }
    if (entry.isDirectory()) {
      const result = findEntryFileRecursive(path.join(dir, entry.name));
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
    lines.push(`    outDir: './out',`);
    lines.push('  },');

    if (baseValues.console?.baudRate || baseValues.console?.output) {
      lines.push('  console: {');
      if (baseValues.console?.baudRate) {
        lines.push(`    baudRate: ${baseValues.console?.baudRate},`);
      }
      // output: 'usb' matters as much as the baud — it rebinds the Zephyr
      // console onto the CDC port so the [TC:...] protocol lines leave via
      // the USB connector (and the board's default UART is freed for tests).
      if (baseValues.console?.output) {
        lines.push(`    output: '${baseValues.console.output}',`);
      }
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
      `  framework: '@typecad/framework-zephyr',`,
      `  frameworkData: { buildTarget: '${buildTarget}' },`,
      '  output: {',
      `    outDir: './out',`,
      '  },',
      '  toolchain: { type: \'west\' },',
      '};',
      '',
      'export default config;',
      '',
    ].join('\n'),
    'utf8',
  );
}
