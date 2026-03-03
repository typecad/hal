// ---------------------------------------------------------------------------
// arduino-cli.ts — Arduino CLI toolchain implementation
//
// Wraps the arduino-cli binary for compile, upload, and monitor operations.
// ---------------------------------------------------------------------------

import path from 'node:path';
import fs from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import type { Toolchain, CompileOptions, CompileResult, UploadOptions, UploadResult, MonitorOptions, CompileError, PortInfo } from './types.js';
import { registerToolchain } from './registry.js';

const GCC_STYLE = /^(.*?):(\d+):(\d+):\s*(fatal error|error|warning|note):\s*(.*)$/i;

/**
 * Parse GCC-style error output into structured errors.
 */
function parseCompileErrors(output: string): CompileError[] {
  const errors: CompileError[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(GCC_STYLE);
    if (!match) continue;

    const severityRaw = match[4].toLowerCase();
    const severity: 'error' | 'warning' | 'note' =
      severityRaw.includes('error') ? 'error' : severityRaw === 'warning' ? 'warning' : 'note';

    errors.push({
      filePath: path.resolve(match[1]),
      line: Number(match[2]),
      column: Number(match[3]),
      severity,
      message: match[5],
    });
  }

  return errors;
}

/**
 * Collect all .cpp files in a directory.
 */
function collectCppFiles(rootDir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.cpp')) continue;
    results.push(path.join(rootDir, entry.name));
  }
  results.sort((a, b) => a.localeCompare(b));
  return results;
}

/**
 * Flatten generated .cpp modules into a single .ino sketch file.
 */
export function flattenGeneratedModulesIntoSketch(sketchDir: string, sketchPath: string): void {
  const normalizedSketchPath = path.resolve(sketchPath);
  const cppFiles = collectCppFiles(sketchDir).filter(
    (filePath) => path.resolve(filePath) !== normalizedSketchPath
  );
  if (cppFiles.length === 0) return;

  const originalSketch = fs.readFileSync(normalizedSketchPath, 'utf8');
  const sanitizedSketch = originalSketch
    .replace(/^\s*#include\s+<Arduino\.h>\s*$/gm, '')
    .replace(/^\s*#include\s+"Arduino\.h"\s*$/gm, '');

  const moduleContents = cppFiles
    .map((cppPath) => {
      const relativePath = path.relative(sketchDir, cppPath).replace(/\\/g, '/');
      const content = fs.readFileSync(cppPath, 'utf8');
      const rewritten = content.replace(
        /^\s*#include\s+"([^"]+)"\s*$/gm,
        (_line, includePath: string) => {
          const resolved = path.resolve(path.dirname(cppPath), includePath);
          if (!resolved.startsWith(path.resolve(sketchDir))) {
            return `#include "${includePath}"`;
          }
          let relativeToSketch = path.relative(sketchDir, resolved).replace(/\\/g, '/');
          relativeToSketch = relativeToSketch.replace(/(^|\/)([^/]+)\/\2(?=\/|$)/g, '$1$2');
          if (!relativeToSketch.startsWith('.')) {
            relativeToSketch = `./${relativeToSketch}`;
          }
          return `#include "${relativeToSketch}"`;
        }
      );
      const sanitized = rewritten
        .replace(/^\s*#include\s+<Arduino\.h>\s*$/gm, '')
        .replace(/^\s*#include\s+"Arduino\.h"\s*$/gm, '');

      const stripped = sanitized
        .replace(/^\s*#include\s+.*$/gm, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .trim();
      if (stripped.length === 0) return '';

      return `\n// ---- merged from ${relativePath} ----\n${sanitized}\n`;
    })
    .join('');

  const mergedSketch = `${moduleContents}\n// ---- entry sketch ----\n${sanitizedSketch}\n`;
  fs.writeFileSync(normalizedSketchPath, mergedSketch, 'utf8');

  for (const cppPath of cppFiles) {
    fs.rmSync(cppPath, { force: true });
  }
}

/**
 * Configuration options for ArduinoCliToolchain.
 */
export interface ArduinoCliToolchainOptions {
  /** Custom path to arduino-cli executable. */
  path?: string;
  /** Path to arduino-cli.yaml config file. */
  configFile?: string;
  /** Enable verbose output. */
  verbose?: boolean;
}

/**
 * Arduino CLI toolchain implementation.
 */
export class ArduinoCliToolchain implements Toolchain {
  readonly id = 'arduino-cli' as const;
  readonly name = 'Arduino CLI';

  private options: ArduinoCliToolchainOptions;

  constructor(options: ArduinoCliToolchainOptions = {}) {
    this.options = options;
  }

  /**
   * Get the path to arduino-cli executable.
   */
  private getExecutablePath(): string {
    return this.options.path || 'arduino-cli';
  }

  /**
   * Check if arduino-cli is installed and available.
   */
  async isInstalled(): Promise<string | undefined> {
    const result = spawnSync(this.getExecutablePath(), ['version'], {
      encoding: 'utf8',
      timeout: 5000,
    });

    if (result.status === 0) {
      return this.getExecutablePath();
    }
    return undefined;
  }

  /**
   * Build arduino-cli arguments common to all commands.
   */
  private buildBaseArgs(): string[] {
    const args: string[] = [];
    if (this.options.configFile) {
      args.push('--config-file', this.options.configFile);
    }
    return args;
  }

  /**
   * Compile a sketch for the target board.
   */
  async compile(options: CompileOptions): Promise<CompileResult> {
    const resolvedSketchFilePath = path.resolve(options.sketchPath);
    let sketchDir = path.dirname(resolvedSketchFilePath);
    let sketchDirName = path.basename(sketchDir);
    let requiredSketchPath = path.join(sketchDir, `${sketchDirName}.ino`);

    // Handle hidden directories
    if (sketchDirName.startsWith('.')) {
      const stagingDir = path.join(path.dirname(sketchDir), 'ts2cpp_sketch');
      try {
        fs.rmSync(stagingDir, { recursive: true, force: true });
        fs.mkdirSync(stagingDir, { recursive: true });
        fs.cpSync(sketchDir, stagingDir, { recursive: true });
        sketchDir = stagingDir;
        sketchDirName = path.basename(sketchDir);
        requiredSketchPath = path.join(sketchDir, `${sketchDirName}.ino`);
      } catch {
        // Best-effort staging
      }
    }

    // Ensure sketch file has correct name
    if (
      path.extname(resolvedSketchFilePath).toLowerCase() === '.ino' &&
      resolvedSketchFilePath !== requiredSketchPath
    ) {
      try {
        const sourceText = fs.readFileSync(resolvedSketchFilePath, 'utf8');
        if (
          !fs.existsSync(requiredSketchPath) ||
          fs.readFileSync(requiredSketchPath, 'utf8') !== sourceText
        ) {
          fs.writeFileSync(requiredSketchPath, sourceText, 'utf8');
        }

        for (const child of fs.readdirSync(sketchDir)) {
          if (!child.toLowerCase().endsWith('.ino')) continue;
          const candidate = path.join(sketchDir, child);
          if (path.resolve(candidate) !== path.resolve(requiredSketchPath)) {
            fs.rmSync(candidate, { force: true });
          }
        }
      } catch {
        // Best-effort sketch alias generation
      }
    }

    // Flatten generated modules
    try {
      if (fs.existsSync(requiredSketchPath)) {
        flattenGeneratedModulesIntoSketch(sketchDir, requiredSketchPath);
      }
    } catch {
      // Best-effort flattening
    }

    // Build compile command
    const args = [
      ...this.buildBaseArgs(),
      'compile',
      '--fqbn',
      options.fqbn,
    ];

    if (this.options.verbose || options.optimize === 'debug') {
      args.push('--verbose');
    }

    // Add defines
    if (options.defines) {
      for (const [key, value] of Object.entries(options.defines)) {
        args.push('--build-property', `compiler.cpp.extra_flags=-D${key}=${value}`);
      }
    }

    // Add extra flags
    if (options.extraFlags && options.extraFlags.length > 0) {
      args.push('--build-property', `compiler.cpp.extra_flags=${options.extraFlags.join(' ')}`);
    }

    args.push(sketchDir);

    const cmd = spawnSync(this.getExecutablePath(), args, {
      encoding: 'utf8',
      timeout: 120000,
    });

    const output = `${cmd.stdout ?? ''}\n${cmd.stderr ?? ''}`.trim();
    const errors = parseCompileErrors(output);

    return {
      success: cmd.status === 0,
      output,
      errors,
    };
  }

  /**
   * Upload compiled firmware to the target board.
   */
  async upload(options: UploadOptions): Promise<UploadResult> {
    const args = [
      ...this.buildBaseArgs(),
      'upload',
      '--fqbn',
      options.fqbn,
      '--port',
      options.port,
      options.sketchDir,
    ];

    if (this.options.verbose) {
      args.push('--verbose');
    }

    const cmd = spawnSync(this.getExecutablePath(), args, {
      encoding: 'utf8',
      timeout: 60000,
    });

    const output = `${cmd.stdout ?? ''}\n${cmd.stderr ?? ''}`.trim();

    return {
      success: cmd.status === 0,
      output,
    };
  }

  /**
   * Open a serial monitor connection.
   */
  async monitor(options: MonitorOptions): Promise<void> {
    const args = [
      ...this.buildBaseArgs(),
      'monitor',
      '--port',
      options.port,
      '--config',
      `baudrate=${options.baud}`,
    ];

    return new Promise((resolve, reject) => {
      const proc = spawn(this.getExecutablePath(), args, {
        stdio: 'inherit',
      });

      proc.on('close', (code) => {
        if (code === 0 || code === null) {
          resolve();
        } else {
          reject(new Error(`Monitor exited with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * List available serial ports.
   */
  async listPorts(): Promise<PortInfo[]> {
    const args = [...this.buildBaseArgs(), 'board', 'list', '--format', 'json'];

    const cmd = spawnSync(this.getExecutablePath(), args, {
      encoding: 'utf8',
      timeout: 10000,
    });

    if (cmd.status !== 0 || !cmd.stdout) {
      return [];
    }

    try {
      const data = JSON.parse(cmd.stdout);
      if (!Array.isArray(data)) return [];

      return data
        .filter((item: any) => item.address)
        .map((item: any): PortInfo => ({
          port: item.address,
          description: item.boards?.[0]?.name || item.protocol || undefined,
          board: item.boards?.[0] ? {
            name: item.boards[0].name,
            fqbn: item.boards[0].fqbn,
          } : undefined,
        }));
    } catch {
      return [];
    }
  }
}

// Register the toolchain
registerToolchain(new ArduinoCliToolchain());

// Export for backward compatibility
export { flattenGeneratedModulesIntoSketch as flattenSketch };