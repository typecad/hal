// ---------------------------------------------------------------------------
// Shared toolchain types and utilities
//
// Compile error types, parsing utilities, and file collection helpers
// shared across toolchain implementations.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";

/**
 * GCC-style error regex
 */
const GCC_STYLE = /^(.*?):(\d+):(\d+):\s*(fatal error|error|warning|note):\s*(.*)$/i;

/**
 * Clang-style error regex
 */
const CLANG_ERROR = /^(.*?):(\d+):(\d+):\s*(error|warning|note):\s*(.*)$/i;

/**
 * Compile error structure
 */
export interface CompileError {
  filePath: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "note";
  message: string;
}

/**
 * Memory usage details
 */
export interface MemoryUsage {
  flashUsed?: number;
  flashTotal?: number;
  ramUsed?: number;
  ramTotal?: number;
}

/**
 * Generic compile options bag. Each framework reads what it needs
 * and ignores the rest. The CLI populates whichever fields are
 * available from CLI flags and config.
 */
export interface ToolchainOptions {
  outputDir: string;
  sourcePath: string;
  buildTarget?: string;
  port?: string;
  baud?: number;
  extraFlags?: string[];
  defines?: Record<string, string>;
  /** ESP32 PSRAM type ('opi' | 'quad') when the target board has PSRAM. */
  psram?: 'opi' | 'quad';
  /**
   * Framework-specific config from `typecad-hal.config.ts`.
   * Each framework casts this to its own typed interface.
   */
  frameworkConfig?: Record<string, unknown>;
  /**
   * Zephyr-specific config from `typecad-hal.config.ts` (the `zephyr` section).
   */
  zephyrConfig?: Record<string, unknown>;
  /**
   * Display config from `typecad-hal.config.ts` (the `display` section).
   * Frameworks use cs/dc/rst/spiFrequency to generate devicetree wiring.
   */
  display?: Record<string, unknown>;
  /**
   * True when `--debug` is active. Frameworks read this to generate debug
   * artifacts (e.g. VS Code launch configs, debug Kconfig symbols) and to
   * select their debug mode (gdb vs printf) via PlatformDebugStrategy.
   */
  debug?: boolean;
}

/**
 * Generic compile result. All frameworks return this shape.
 */
export interface CompileResult {
  success: boolean;
  output: string;
  errors: CompileError[];
  memoryUsage?: MemoryUsage;
}

/**
 * Generic upload result. All frameworks return this shape.
 */
export interface UploadResult {
  success: boolean;
  output: string;
}

/**
 * Parse compile errors from output (GCC and Clang formats)
 */
export function parseCompileErrors(output: string, projectDir?: string): CompileError[] {
  const errors: CompileError[] = [];

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    let match = line.match(GCC_STYLE);

    if (!match) {
      match = line.match(CLANG_ERROR);
    }

    if (!match) {
      continue;
    }

    const severityRaw = match[4].toLowerCase();
    const severity: "error" | "warning" | "note" =
      severityRaw.includes("error") ? "error" : severityRaw === "warning" ? "warning" : "note";

    let filePath = match[1];

    // Normalize file paths
    if (projectDir) {
      if (!path.isAbsolute(filePath)) {
        const resolved = path.resolve(projectDir, filePath);
        if (fs.existsSync(resolved)) {
          filePath = resolved;
        }
      }
    }

    errors.push({
      filePath: path.resolve(filePath),
      line: parseInt(match[2], 10),
      column: parseInt(match[3], 10),
      severity,
      message: match[5],
    });
  }

  return errors;
}

/**
 * Collect all .cpp files in a directory (non-recursive).
 */
export function collectCppFiles(rootDir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(rootDir)) {
    return results;
  }

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".cpp")) {
      continue;
    }
    results.push(path.join(rootDir, entry.name));
  }
  results.sort((a, b) => a.localeCompare(b));
  return results;
}
