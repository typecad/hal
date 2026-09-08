// ---------------------------------------------------------------------------
// cuttlefish test-runner — Compiler
//
// Wraps the typecad-hal transpiler + west compile/flash cycle. Takes
// preprocessed TypeScript source, transpiles to C++, compiles, uploads.
// ---------------------------------------------------------------------------

import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseConfigAST } from './config.js';

// createRequire lets us use require() in an ESM module for the project's
// framework package (resolved from the project's node_modules).
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
 * the preprocessed source to a temp file, invokes the typecad-hal transpiler,
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

  // Invoke the typecad-hal transpiler
  // We call it as a CLI command rather than importing to avoid coupling
  const cuttlefishCmd = resolveCuttlefishCmd(projectRoot);
  // Use build mode (run `typecad-hal build` from a build dir that holds its own
  // generated typecad-hal.config.ts) when the test source has relative imports
  // OR when an explicit configPath was passed. The latter matters because
  // direct-file mode discovers typecad-hal.config.ts from cwd (projectRoot),
  // which is the DEFAULT config — so a project with several target-specific
  // configs (e.g. packages/hal/tests/network/typecad-hal.config.ts vs ble-demo.config.ts)
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
 * Compile the Zephyr project via `west build` (through the project's
 * framework Toolchain).
 */
export function compileProgram(projectDir: string, buildTarget: string, zephyrConfig?: Record<string, unknown>, framework?: string): CompileResult {
  return compileWestProject(projectDir, buildTarget, zephyrConfig, framework);
}

/**
 * Upload the compiled project to the board via `west flash` (through the
 * project's framework Toolchain).
 */
export function uploadProgram(
  projectDir: string,
  buildTarget: string,
  port: string,
  zephyrConfig?: Record<string, unknown>,
  framework?: string,
): UploadResult {
  return uploadWestProject(projectDir, buildTarget, port, zephyrConfig, framework);
}

// ---------------------------------------------------------------------------
// Zephyr (west) toolchain
// ---------------------------------------------------------------------------

/**
 * Resolve the framework package from the PROJECT's node_modules and load its
 * Toolchain. The framework is a project dependency — the engine never
 * depends on it — so resolution anchors at the project dir (then cwd),
 * exactly like the engine's own framework loading.
 */
function loadFrameworkToolchain(projectDir: string, framework?: string): {
  Toolchain?: { compile?: (opts: unknown) => { success: boolean; output: string }; upload?: (opts: unknown) => { success: boolean; output: string } };
} {
  const spec = framework ?? '@typecad/framework-zephyr';
  for (const base of [projectDir, process.cwd()]) {
    try {
      const resolved = require.resolve(spec, { paths: [base] });
      return require(resolved);
    } catch {
      /* not resolvable from this base — try the next */
    }
  }
  throw new Error(
    `Could not resolve the framework package '${spec}' from ${projectDir} — is it installed? Run npm install in the project.`,
  );
}

/**
 * Compile a Zephyr project via `west build`. The project's framework
 * Toolchain (e.g. @typecad/framework-zephyr) handles west discovery,
 * ZEPHYR_BASE, scaffolding, and the board target.
 */
function compileWestProject(projectDir: string, buildTarget: string, zephyrConfig?: Record<string, unknown>, framework?: string): CompileResult {
  // projectDir for Zephyr is the project root containing src/, app/, build/.
  // The transpiler emits src/src.cpp; the west project root is the parent of src/.
  const srcDir = path.join(projectDir, 'src');
  const projectRoot = fs.existsSync(srcDir) ? projectDir : path.dirname(projectDir);
  const sourcePath = fs.existsSync(path.join(srcDir, 'src.cpp'))
    ? path.join(srcDir, 'src.cpp')
    : path.join(projectDir, 'src.cpp');
  const outputDir = fs.existsSync(srcDir) ? srcDir : projectDir;

  try {
    const mod = loadFrameworkToolchain(projectRoot, framework);
    const Toolchain = mod.Toolchain;
    if (!Toolchain || typeof Toolchain.compile !== 'function') {
      return { success: false, projectDir, sourcePath: '', output: '', error: 'The project framework did not export a usable Toolchain.compile().' };
    }
    const result = Toolchain.compile({
      outputDir,
      sourcePath,
      buildTarget,
      zephyrConfig,
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
function uploadWestProject(projectDir: string, buildTarget: string, port: string, zephyrConfig?: Record<string, unknown>, framework?: string): UploadResult {
  const srcDir = path.join(projectDir, 'src');
  const projectRoot = fs.existsSync(srcDir) ? projectDir : path.dirname(projectDir);
  const sourcePath = fs.existsSync(path.join(srcDir, 'src.cpp'))
    ? path.join(srcDir, 'src.cpp')
    : path.join(projectDir, 'src.cpp');
  const outputDir = fs.existsSync(srcDir) ? srcDir : projectDir;

  try {
    const mod = loadFrameworkToolchain(projectRoot, framework);
    const Toolchain = mod.Toolchain;
    if (!Toolchain || typeof Toolchain.upload !== 'function') {
      return { success: false, output: '', error: 'The project framework did not export a usable Toolchain.upload().' };
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

function resolveCuttlefishCmd(_projectRoot: string): string {
  // The test-runner ships INSIDE the engine — the CLI to spawn is this
  // package's own dist/cli.js, always the same version as the running code.
  // (The JS entry point rather than the .bin shim because the shell wrapper
  // cannot be passed to `node process.execPath` on Windows.)
  return path.resolve(__dirname, '..', 'cli.js');
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
  // back to typecad-hal.config.ts in the project root. The transpile runs from
  // buildDir, so we inline the scalar fields the typecad-hal transpiler needs
  // (target/board/mcu/framework/buildTarget/toolchain/zephyr) into a generated
  // typecad-hal.config.ts there — the config loader can't evaluate spreads or
  // relative imports, and discovery from buildDir would find no config.
  const baseConfigPath = configPath ?? path.join(projectRoot, 'typecad-hal.config.ts');
  const buildConfigPath = path.join(buildDir, 'typecad-hal.config.ts');

  if (fs.existsSync(baseConfigPath)) {
    // Parse base config via AST to extract scalar values, then inline them.
    // This avoids spreads (...baseConfig) which the config loader cannot evaluate.
    const baseValues = parseConfigAST(baseConfigPath);
    const lines = [
      `import type { TypecadConfig } from '@typecad/hal/config';`,
      '',
      'const config: TypecadConfig = {',
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
      `import type { TypecadConfig } from '@typecad/hal/config';`,
      '',
      'const config: TypecadConfig = {',
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
