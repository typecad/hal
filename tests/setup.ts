import { buildProgramIR } from "../packages/cli/src/ir/build-ir";
import { analyzePeripheralUsage } from "../packages/cli/src/ir/peripheral-usage";
import { emitCpp } from "../packages/cli/src/emit/cpp-emitter";
import { EmitMode, GeneratedOutputs, TargetProfile, PlatformContext } from "../packages/cli/src/types";
import { setFrameworkApi } from "../packages/cli/src/framework-api";
import { expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Load the default framework package so polyfill generators and emitters
// can access framework functions without going through transpileFile().
// eslint-disable-next-line @typescript-eslint/no-var-requires
setFrameworkApi(require("../packages/framework-arduino"));

// Ensure output directory exists
const testOutDir = ".build/tests";
if (!fs.existsSync(testOutDir)) {
  fs.mkdirSync(testOutDir, { recursive: true });
}

export interface TranspileResult {
  cpp: string;
  header?: string;
  diagnostics: GeneratedOutputs["diagnostics"];
}

export interface TranspileOptions {
  target?: TargetProfile;
  emitMode?: EmitMode;
  platformContext?: PlatformContext;
}

let testCounter = 0;

/**
 * Helper function to transpile TypeScript to C++ for testing
 * Uses unique filenames to avoid test isolation issues
 */
export function transpile(tsCode: string, options: TranspileOptions = {}): TranspileResult {
  const { target = "generic", emitMode = "cpp", platformContext } = options;
  
  // Use unique filename based on caller info + counter to ensure isolation
  const uniqueId = `test_${process.pid}_${testCounter++}_${Date.now()}`;
  const fileName = `${uniqueId}.ts`;
  
  // For Arduino target, use a unique output directory to avoid filename collisions
  // since Arduino uses the directory name as the .ino filename
  const uniqueOutDir = target === "arduino" 
    ? path.join(testOutDir, uniqueId)
    : testOutDir;
  if (target === "arduino" && !fs.existsSync(uniqueOutDir)) {
    fs.mkdirSync(uniqueOutDir, { recursive: true });
  }
  
  const programIR = buildProgramIR(fileName, tsCode);
  const libdefs = new Map();
  const result = emitCpp(programIR, {
    outDir: uniqueOutDir,
    emitMode,
    target,
    libdefs,
    emitMaps: false,
    platformContext,
  });

  let cpp = "";
  let header: string | undefined;
  
  if (result.sourcePath && fs.existsSync(result.sourcePath)) {
    cpp = fs.readFileSync(result.sourcePath, "utf-8");
    // Clean up
    fs.unlinkSync(result.sourcePath);
  }
  
  if (result.headerPath && fs.existsSync(result.headerPath)) {
    header = fs.readFileSync(result.headerPath, "utf-8");
    // Clean up
    fs.unlinkSync(result.headerPath);
  }

  return { cpp, header, diagnostics: result.diagnostics };
}

export function transpileArduino(tsCode: string, options: Omit<TranspileOptions, "target"> = {}): TranspileResult {
  return transpile(tsCode, { ...options, target: "arduino" });
}

/**
 * Helper to strip whitespace for comparison while maintaining readability
 */
export function normalizeCpp(code: string): string {
  return code
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Helper to check if C++ code contains expected lines (in order)
 */
export function containsLines(cpp: string, lines: string[]): boolean {
  const normalized = normalizeCpp(cpp);
  let lastIndex = -1;
  for (const line of lines) {
    const normalizedLine = normalizeCpp(line);
    const index = normalized.indexOf(normalizedLine);
    if (index === -1 || index <= lastIndex) {
      return false;
    }
    lastIndex = index;
  }
  return true;
}

/**
 * Helper to extract a function body from C++ code
 */
export function extractFunction(cpp: string, functionName: string): string | null {
  const regex = new RegExp(`${functionName}\\s*\\([^)]*\\)\\s*\\{([^}]*(?:\\{[^}]*\\}[^}]*)*)\\}`, "s");
  const match = cpp.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * Helper to check if an include is present
 */
export function hasInclude(cpp: string, include: string): boolean {
  const pattern = include.startsWith("<") || include.startsWith('"')
    ? `#include ${include}`
    : `#include <${include}>`;
  return cpp.includes(pattern);
}

export function expectCppContains(result: TranspileResult, snippets: string[]): void {
  for (const snippet of snippets) {
    expect(result.cpp).toContain(snippet);
  }
}

export function expectCppNotContains(result: TranspileResult, snippets: string[]): void {
  for (const snippet of snippets) {
    expect(result.cpp).not.toContain(snippet);
  }
}

export function findDiagnostics(result: TranspileResult, code: string) {
  return result.diagnostics.filter((diagnostic) => diagnostic.code === code);
}

export function analyzeUsage(tsCode: string) {
  const ir = buildProgramIR("test.ts", tsCode);
  return analyzePeripheralUsage(ir);
}