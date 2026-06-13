import {
  buildProgramIR,
  emitCpp,
  analyzePeripheralUsage,
  setLoadedFramework,
  registerPlatformStrategy,
  resolveStrategy,
  clearAllProfileCaches
} from "../packages/cuttlefish/src/testing";
import { setActiveStrategy } from "../packages/cuttlefish/src/ir/hal-resolver";
import type { EmitMode, GeneratedOutputs, TargetProfile, PlatformContext } from "../packages/cuttlefish/src/types";
import { ArduinoStrategy } from "../packages/framework-arduino/src";
import { NativeStrategy } from "../packages/framework-native/src";
import { expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Load the default framework package so polyfill generators and emitters
// can access framework functions without going through transpileFile().
const _arduinoStrategy = new ArduinoStrategy();
const _nativeStrategy = new NativeStrategy();
setLoadedFramework({ strategy: _arduinoStrategy });
registerPlatformStrategy(_arduinoStrategy);
registerPlatformStrategy(_nativeStrategy);
setActiveStrategy(_arduinoStrategy);

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
  boardPackage?: string;
}

let testCounter = 0;

/**
 * Helper function to transpile TypeScript to C++ for testing
 * Uses unique filenames to avoid test isolation issues
 */
export function transpile(tsCode: string, options: TranspileOptions = {}): TranspileResult {
  const { target = "generic", emitMode = "cpp", platformContext, boardPackage } = options;

  setActiveStrategy(resolveStrategy(target));

  // clearAllProfileCaches() is removed to allow strategy-level caching across tests

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

  const programIR = buildProgramIR(fileName, tsCode, boardPackage);
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

export function transpileAVR(tsCode: string): TranspileResult {
  return transpile(tsCode, { 
    target: "arduino", 
    platformContext: { frameworkData: { buildTarget: "arduino:avr:uno" } } 
  });
}

export function transpileESP32(tsCode: string): TranspileResult {
  return transpile(tsCode, { 
    target: "arduino", 
    platformContext: { frameworkData: { buildTarget: "esp32:esp32:devkitv1" } } 
  });
}

export function transpileNative(tsCode: string): TranspileResult {
  return transpile(tsCode, { target: "native" });
}

/**
 * Helper to strip whitespace for comparison while maintaining readability
 */
export function normalizeCpp(code: string): string {
  return code
    .replace(/\/\/.*/g, "") // Strip // comments
    .replace(/\/\*[\s\S]*?\*\//g, "") // Strip /* */ comments
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Semantic C++ matching helper.
 * Strips comments and normalizes whitespace for robust comparisons.
 */
export function matchesCpp(cpp: string, expected: string | string[]): void {
  const normalizedCpp = normalizeCpp(cpp);
  const expectedSnippets = Array.isArray(expected) ? expected : [expected];

  for (const snippet of expectedSnippets) {
    const normalizedSnippet = normalizeCpp(snippet);
    expect(normalizedCpp).toContain(normalizedSnippet);
  }
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

/**
 * Snapshot diagnostics to ensure error reporting remains consistent.
 */
export function expectDiagnosticsMatchSnapshot(result: TranspileResult): void {
  const stable = result.diagnostics.map(d => ({
    code: d.code,
    severity: d.severity,
    message: d.message,
    line: d.line,
    column: d.column
  }));
  expect(stable).toMatchSnapshot();
}

export function analyzeUsage(tsCode: string) {
  const ir = buildProgramIR("test.ts", tsCode);
  return analyzePeripheralUsage(ir);
}
