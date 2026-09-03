import {
  buildProgramIR,
  emitCpp,
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
import { NativeStrategy } from "../packages/cuttlefish/src/frameworks/native";
import { ZephyrStrategy } from "../packages/framework-zephyr/src/strategy";
import { generateBoard } from "../packages/framework-zephyr/src/boardgen";
import { expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Load the default framework package so polyfill generators and emitters
// can access framework functions without going through transpileFile().
// Legacy framework-arduino removed — the Zephyr strategy is the default
// test target. Suites exercising legacy class lowerings must use the zephyr
// transpilers or explicit strategies.
const _zephyrDefault = new ZephyrStrategy();
const _nativeStrategy = new NativeStrategy();
setLoadedFramework({ strategy: _zephyrDefault });
registerPlatformStrategy(_zephyrDefault);
registerPlatformStrategy(_nativeStrategy);
setActiveStrategy(_zephyrDefault);

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

interface TranspileOptions {
  target?: TargetProfile;
  emitMode?: EmitMode;
  platformContext?: PlatformContext;
  boardPackage?: string;
  /**
   * Optional board constants injected into the built ProgramIR (overriding
   * whatever buildProgramIR derived). Lets tests exercise the board-derived
   * chip resolution path (framework-zephyr's resolveChipFromBoard) without
   * the full CLI config — e.g. the blackpill dry run.
   */
  boardConstants?: import("../packages/cuttlefish/src/api/shared/index.js").BoardConstants;
  /**
   * Optional generated board module source, written beside board.json as
   * .cuttlefish/board.ts. findGeneratedBoard requires BOTH files, and a
   * program importing '@typecad/board' transpiles the .ts — pass the
   * generateBoard(target).boardTs output here to exercise the full
   * board-module path (pin exports, hardware re-exports).
   */
  boardTs?: string;
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
  let fileName = options.fileName ?? `${uniqueId}.ts`;

  // Per-call unique output directory for EVERY target — parallel vitest
  // workers writing+deleting src.cpp/src.h in one shared dir produced an
  // intermittent empty-file read race (the "expected '' to contain" flake).
  const uniqueOutDir = path.join(testOutDir, uniqueId);
  fs.mkdirSync(uniqueOutDir, { recursive: true });

  // transpile.ts's import-graph build loads relative .ui.html modules into
  // the UI registry before IR building; direct buildProgramIR callers must
  // warm the registry themselves or ui.mount() lowering throws.
  if (options.fileName && hasUIHook()) {
    for (const m of tsCode.matchAll(/from\s+['"]([^'"]*\.ui\.html)['"]/g)) {
      if (!m[1].startsWith(".")) continue;
      requireUIHook().loadUIModule(path.resolve(path.dirname(options.fileName), m[1]));
    }
  }

  // Mirror the real pipeline: when a test supplies board constants, write
  // them as the project's generated board manifest (.cuttlefish/board.json
  // beside the source file) so build-ir's own default-constants fallback
  // loads them exactly the way ensureGeneratedBoard does in a real project.
  if (options.boardConstants) {
    const cfDir = path.join(uniqueOutDir, '.cuttlefish');
    fs.mkdirSync(cfDir, { recursive: true });
    fs.writeFileSync(path.join(cfDir, 'board.json'), JSON.stringify({
      version: 1,
      identifier: String(options.boardConstants.get('build.frameworks.zephyr') ?? 'test'),
      constants: Object.fromEntries(options.boardConstants),
    }));
    if (options.boardTs) {
      fs.writeFileSync(path.join(cfDir, 'board.ts'), options.boardTs);
    }
    if (!options.fileName) {
      fileName = path.join(uniqueOutDir, 'main.ts');
    }
  }
  const programIR = buildProgramIR(fileName, tsCode, boardPackage);
  if (options.boardConstants) {
    programIR.boardConstants = options.boardConstants;
  }
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
  // The equal path: a real project carries .cuttlefish/board.json (written
  // by ensureGeneratedBoard from the catalog). The harness simulates that
  // step for the test target so the strategy resolves the same chip view a
  // real build gets — there is no curated registry to fall back to.
  const g = generateBoard("esp32s3_devkitc/esp32s3/procpu");
  return transpile(tsCode, {
    strategy: _zephyrStrategy,
    target: "zephyr",
    boardConstants: new Map(Object.entries(JSON.parse(g.boardJson).constants)) as any,
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
