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
    fs.mkdirSync(buildDir, { recursive: true });
  } catch {
    return { success: false, sketchDir: buildDir, sketchPath: '', output: '', error: `Failed to create build dir: ${buildDir}` };
  }

  // Write the preprocessed source as a .ts file
  const tsPath = path.join(buildDir, `${baseName}.ts`);
  fs.writeFileSync(tsPath, preprocessedSource, 'utf8');

  // Invoke the typecode transpiler
  // We call it as a CLI command rather than importing to avoid coupling
  const typecodeCmd = resolveTypecodeCmd(projectRoot);
  const result = spawnSync(
    process.execPath,
    [typecodeCmd, tsPath],
    {
      encoding: 'utf8',
      cwd: projectRoot,
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
  // Try to find typecode CLI in the monorepo
  const candidates = [
    path.join(projectRoot, 'packages', 'cli', 'dist', 'cli.js'),
    path.join(projectRoot, 'node_modules', '.bin', 'typecode'),
    path.join(projectRoot, 'node_modules', 'typecode', 'dist', 'cli.js'),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
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
