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
import { hasSafetyHook, requireSafetyHook } from "../packages/cuttlefish/src/safety-hook";
import { hasUIHook, requireUIHook } from "../packages/cuttlefish/src/ui-hook";
import type { EmitMode, GeneratedOutputs, TargetProfile, PlatformContext, ComplianceMode } from "../packages/cuttlefish/src/types";
import type { PlatformStrategy } from "../packages/cuttlefish/src/api/shared/platform-strategy";
import { ArduinoStrategy } from "../packages/framework-arduino/src";
import { NativeStrategy } from "../packages/framework-native/src";
import { ZephyrStrategy } from "../packages/framework-zephyr/src/strategy";
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
  /**
   * Optional explicit strategy. When provided, overrides target-based
   * resolution so semantic-op HAL lowering routes through the given
   * strategy's resolveHALOperation instead of the default.
   */
  strategy?: PlatformStrategy;
  /** AUTOSAR C++14 compliance mode for this transpile. Default "off". */
  autosar?: ComplianceMode;
  /**
   * Optional real path for the entry file. When provided, relative imports
   * (e.g. `./counter.ui.html`) resolve against this file's directory instead
   * of a synthetic name, matching how transpile.ts resolves user projects.
   */
  fileName?: string;
}

let testCounter = 0;

/**
 * Helper function to transpile TypeScript to C++ for testing
 * Uses unique filenames to avoid test isolation issues
 */
export function transpile(tsCode: string, options: TranspileOptions = {}): TranspileResult {
  const { target = "generic", emitMode = "cpp", platformContext, boardPackage, strategy } = options;

  // An explicit strategy wins; otherwise resolve by target. The default-
  // strategy test infra registers ArduinoStrategy for "arduino", so plain
  // transpile()/transpileArduino() keep their existing behavior.
  setActiveStrategy(strategy ?? resolveStrategy(target));

  // clearAllProfileCaches() is removed to allow strategy-level caching across tests

  // Use unique filename based on caller info + counter to ensure isolation,
  // unless the caller supplied a real entry path (needed for relative
  // .ui.html / cross-file import resolution).
  const uniqueId = `test_${process.pid}_${testCounter++}_${Date.now()}`;
  const fileName = options.fileName ?? `${uniqueId}.ts`;

  // For Arduino target, use a unique output directory to avoid filename collisions
  // since Arduino uses the directory name as the .ino filename
  const uniqueOutDir = target === "arduino"
    ? path.join(testOutDir, uniqueId)
    : testOutDir;
  if (target === "arduino" && !fs.existsSync(uniqueOutDir)) {
    fs.mkdirSync(uniqueOutDir, { recursive: true });
  }

  // transpile.ts's import-graph build loads relative .ui.html modules into
  // the UI registry before IR building; direct buildProgramIR callers must
  // warm the registry themselves or ui.mount() lowering throws.
  if (options.fileName && hasUIHook()) {
    for (const m of tsCode.matchAll(/from\s+['"]([^'"]*\.ui\.html)['"]/g)) {
      if (!m[1].startsWith(".")) continue;
      requireUIHook().loadUIModule(path.resolve(path.dirname(options.fileName), m[1]));
    }
  }

  const programIR = buildProgramIR(fileName, tsCode, boardPackage);
  // Phase D — safety transform (mirrors transpile.ts: when @typecad/safety is
  // loaded, run its post-build IR transform so safe.* calls get their
  // companions and the polyfill tree-shaking keys land in the IR).
  if (hasSafetyHook()) {
    const hook = requireSafetyHook();
    const transformed = hook.transformIR(programIR, {
      safetyInUse: programIR.imports.some((i) => i.moduleSpecifier === "@typecad/safety"),
      target,
    });
    Object.assign(programIR, transformed);
  }
  const libdefs = new Map();
  const result = emitCpp(programIR, {
    outDir: uniqueOutDir,
    emitMode,
    target,
    libdefs,
    emitMaps: false,
    platformContext,
    autosar: options.autosar,
    // Pass the active strategy through so the statement/expression renderers
    // pick it up via context.strategy (not just the setActiveStrategy side
    // effect, which only covers expression-position hal-expr resolution).
    ...(strategy ? { strategy } : {}),
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

// Drive the Zephyr strategy's HAL lowering (resolveHALOperation) end-to-end.
// The http.* / wifi.* ops lower via the strategy, which the plain transpile()
// target-based resolution does not activate (zephyr is not a default-strategy
// target in tests). Instantiating ZephyrStrategy and passing it as `strategy`
// routes semantic-op resolution through it. Mirrors how the deleted
// transpileEsp32Strategy worked relative to Esp32Strategy. Lazily built so the
// strategy's profile caches are reused across tests.
//
// Targets esp32s3_devkitc: HTTP/WiFi need a networked chip, and
// profileDiagnostics flags their use on a radioless target (xiao_ble). Setting
// the target here means the "compiles cleanly" assertion in the http harness
// sees no zephyr-http-unavailable-on-target diagnostic.
let _zephyrStrategy: ZephyrStrategy | undefined;
export function transpileZephyrStrategy(tsCode: string): TranspileResult {
  if (!_zephyrStrategy) _zephyrStrategy = new ZephyrStrategy();
  return transpile(tsCode, {
    strategy: _zephyrStrategy,
    target: "zephyr",
    platformContext: { frameworkData: { target: "esp32s3_devkitc" } } as any,
  });
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
 * Diagnostic codes that reflect the build environment rather than the code
 * under test (e.g. whether `arduino-cli` is installed on the runner). These
 * are excluded from snapshots so tests are stable across local/CI machines.
 */
const ENVIRONMENT_DEPENDENT_DIAGNOSTIC_CODES = new Set([
  "TS2CPP_ARDUINO_CLI_PROBE_FAILED",
  "TS2CPP_ARDUINO_CLI_PARSE_FAILED",
]);

/**
 * Snapshot diagnostics to ensure error reporting remains consistent.
 * Environment-dependent diagnostics (arduino-cli availability, etc.) are
 * filtered out — they vary between local and CI machines and are not part of
 * the semantic behavior under test.
 */
export function expectDiagnosticsMatchSnapshot(result: TranspileResult): void {
  const stable = result.diagnostics
    .filter(d => !ENVIRONMENT_DEPENDENT_DIAGNOSTIC_CODES.has(d.code))
    .map(d => ({
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
