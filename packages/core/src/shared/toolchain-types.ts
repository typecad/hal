// ---------------------------------------------------------------------------
// Shared toolchain types and utilities
//
// Compile error types, parsing utilities, and file collection helpers
// shared across toolchain implementations.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";

/**
 * GCC-style error regex (used by arduino-cli, platformio, gcc)
 */
export const GCC_STYLE = /^(.*?):(\d+):(\d+):\s*(fatal error|error|warning|note):\s*(.*)$/i;

/**
 * Arduino-style error regex (sometimes missing column)
 */
export const ARDUINO_ERROR = /^(.*?):(\d+):\d+:\s*(error|warning|note):\s*(.*)$/i;

/**
 * Clang-style error regex
 */
export const CLANG_ERROR = /^(.*?):(\d+):(\d+):\s*(error|warning|note):\s*(.*)$/i;

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
 * Generic compile options bag. Each framework reads what it needs
 * and ignores the rest. The CLI populates whichever fields are
 * available from CLI flags and config.
 */
export interface ToolchainOptions {
  outputDir: string;
  sourcePath: string;
  fqbn?: string;
  port?: string;
  baud?: number;
  optimize?: string;
  extraFlags?: string[];
  defines?: Record<string, string>;
  /**
   * Framework-specific config from `typecode.config.ts`.
   * Each framework casts this to its own typed interface.
   */
  frameworkConfig?: Record<string, unknown>;
}

/**
 * Generic compile result. All frameworks return this shape.
 */
export interface CompileResult {
  success: boolean;
  output: string;
  errors: CompileError[];
}

/**
 * Generic upload result. All frameworks return this shape.
 */
export interface UploadResult {
  success: boolean;
  output: string;
}

/** @deprecated Use CompileResult */
export type ArduinoCompileResult = CompileResult;
/** @deprecated Use UploadResult */
export type ArduinoUploadResult = UploadResult;

/**
 * Parse compile errors from output (GCC, Arduino, and Clang formats)
 */
export function parseCompileErrors(output: string, sketchDir?: string): CompileError[] {
  const errors: CompileError[] = [];

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    let match = line.match(GCC_STYLE);
    if (!match) {
      match = line.match(ARDUINO_ERROR);
      if (match) {
        // Arduino error format: file:line:column: severity: message
        // Sometimes column is missing, so we use 1 as default
        match = [match[0], match[1], match[2], "1", match[3], match[4]];
      }
    }

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
    if (sketchDir) {
      // Try to resolve relative paths against sketch directory
      if (!path.isAbsolute(filePath)) {
        const resolved = path.resolve(sketchDir, filePath);
        if (fs.existsSync(resolved)) {
          filePath = resolved;
        }
      }

      // Handle sketch directory references
      if (filePath.includes(path.basename(sketchDir))) {
        filePath = path.resolve(sketchDir, path.basename(sketchDir) + ".ino");
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
 * For recursive collection, use collectCppFilesRecursive.
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

/**
 * Extract architecture from FQBN string
 * FQBN format: vendor:arch:board[:config]
 * e.g., "arduino:avr:uno" -> "avr"
 */
export function toArchitectureFromFqbn(fqbn?: string): string | undefined {
  if (!fqbn) {
    return undefined;
  }
  const parts = fqbn.split(":");
  // parts[0] = vendor, parts[1] = architecture, parts[2] = board
  return parts[1];
}
