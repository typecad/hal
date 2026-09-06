// ---------------------------------------------------------------------------
// GenericStrategy — standard C++ target (main(), <cmath> …)
// ---------------------------------------------------------------------------

import type { PlatformStrategy, AsyncRuntimeConfig } from "../api/shared/index.js";
import type { ExpressionIR, ProgramIR } from "../api/index.js";
import type { BoardConstants } from "../api/shared/index.js";
import type { Diagnostic, PlatformContext } from "../types.js";
import { generateGenericInitCode, generateGenericBreakpointCode, generateGenericLogpointCode } from "./generic-debug-codegen.js";
import type { RuntimePolyfillIR, StdLibSupport } from "../api/shared/index.js";
import type { PlatformGraphicsStrategy, GraphicsCapacity, DisplayHALOp } from "../api/shared/index.js";
import { DEFAULT_STDLIB_SUPPORT } from "../api/shared/index.js";
import { parsedIsPointer } from "../api/shared/cpp-type-ir.js";
import { buildAsyncRuntimePolyfill } from "./async-runtime.js";

export class GenericStrategy implements PlatformStrategy {
  readonly id = "generic";
  private _largeEnumNames: ReadonlySet<string> = new Set();

  // ── Profile ─────────────────────────────────────────────────────────────

  forcedIncludes(_program: ProgramIR, _ctx?: PlatformContext): string[] {
    return [];
  }
  symbolAliases(_program: ProgramIR, _ctx?: PlatformContext): Record<string, string> {
    return {};
  }
  shimLines(_program: ProgramIR, _ctx?: PlatformContext): string[] {
    return [];
  }
  profileDiagnostics(_program: ProgramIR, _ctx?: PlatformContext): Diagnostic[] {
    return [];
  }

  // ── File shape ──────────────────────────────────────────────────────────

  sourceExtension(_isEntryFile: boolean, _isNpmPackage: boolean): string {
    return "cpp";
  }
  entrypointFunctionName(): string {
    return "main";
  }
  requiresLoopFunction(): boolean {
    return false;
  }
  overrideBaseName(originalBaseName: string, _outDirBaseName: string, _isEntryFile: boolean, _isNpmPackage: boolean): string {
    return originalBaseName;
  }
  effectiveEmitMode(requestedMode: string, _isNpmPackage: boolean): string {
    return requestedMode;
  }

  // ── Type normalisation ──────────────────────────────────────────────────

  normalizeCppType(typeName: string): string {
    if (typeName === "auto") return this.defaultNumericType();
    return typeName;
  }
  defaultNumericType(compliance?: { isBanned(ruleId: string): boolean }): string {
    // A3-9-1: fixed-width integers under AUTOSAR. Legacy 'int' spelling
    // preserved when autosar is off so default output is byte-identical.
    return compliance?.isBanned("A3-9-1") ? "int32_t" : "int";
  }
  mapReturnType(_functionName: string, returnType: string): string {
    return this.normalizeCppType(returnType);
  }
  isStringLikeType(cppType: string): boolean {
    // Note: this is the platform-policy definition of "string-like" — kept as
    // an exact set (std::string, const char*, char*) because platform overrides
    // (Arduino's `String`, etc.) extend it with platform-specific types. The
    // broader structural `parsedIsStringLike` is used at consumer sites that
    // don't depend on platform policy.
    return cppType === "std::string" || cppType === "const char*" || cppType === "char*";
  }
  isPointerType(cppType: string): boolean {
    return parsedIsPointer(cppType);
  }
  mapFunctionName(originalName: string): string {
    if (originalName === "__cuttlefish_entrypoint__") return "main";
    return originalName;
  }

  // ── Expression rendering ────────────────────────────────────────────────

  normalizeRawExpression(value: string): string {
    return value;
  }
  nullValue(): string {
    return "";
  }
  wrapStringConcat(_leftRendered: string, _rightRendered: string, _leftIsString: boolean): string | undefined {
    return undefined;
  }
  wrapStringObject(expr: string): string {
    return `std::to_string(${expr})`;
  }
  useSnprintfForStrings(): boolean {
    // Native uses snprintf for string concatenation so that non-arithmetic
    // values (enums, class instances) never hit std::to_string() and floats
    // get JS-compatible formatting. This unifies native with the Arduino/AVR
    // snprintf path; see inferFormatSpecifier for per-type format specifiers.
    return true;
  }
  renameEnumMember(_enumName: string, memberName: string): string {
    return memberName;
  }
  setLargeEnumNames(names: ReadonlySet<string>): void {
    this._largeEnumNames = names;
  }

  enumCastType(enumName: string): string | undefined {
    return undefined;
  }
  renderBoardDefinitionAccess(
    _chain: string[],
    _boardConstants?: BoardConstants,
  ): string | undefined {
    return undefined;
  }

  // ── Statement rendering ─────────────────────────────────────────────────

  renderThrow(valueExpr: string): string {
    return `throw ${valueExpr};`;
  }
  objectFieldInitializer(_fieldValue: ExpressionIR, _renderExpr: (e: ExpressionIR) => string): string | undefined {
    return undefined;
  }
  overrideClassFieldType(_fieldName: string, _normalizedType: string): string {
    return _normalizedType;
  }

  // ── Name guards ─────────────────────────────────────────────────────────

  reservedNames(): ReadonlySet<string> {
    return new Set<string>();
  }
  passthroughMacroNames(): ReadonlySet<string> {
    return new Set<string>();
  }
  apiReservedEnumNames(): ReadonlySet<string> {
    return new Set<string>();
  }
  apiReservedEnumGuard(): string {
    return "";
  }

  // ── Includes ────────────────────────────────────────────────────────────

  needsIostream(): boolean { return true; }
  needsStdString(): boolean { return true; }
  needsStdVector(): boolean { return true; }
  needsStdExcept(): boolean { return true; }
  needsStdFunction(): boolean { return true; }
  mathHeader(): string { return "<cmath>"; }
  cstringHeader(): string { return "<cstring>"; }

  // ── Enum underlying type ────────────────────────────────────────────────

  needsLargeEnumUnderlying(): boolean { return false; }

  // ── Struct field handling ───────────────────────────────────────────────

  renameStructField(fieldName: string): string { return fieldName; }
  structFieldInitializer(
    _fieldValue: ExpressionIR,
    _compiletimeVarNames: Set<string>,
    _renderExpr: (e: ExpressionIR) => string,
  ): string | undefined {
    return undefined;
  }

  // ── Async ───────────────────────────────────────────────────────────────

  getAsyncRuntimeConfig(): AsyncRuntimeConfig {
    return {
      queueCapacity: this.asyncQueueCapacity(),
      scheduler: "microtask",
      waitForPinEdge: "stub",
      hasPromiseRuntime: true,
      hasTimers: false,
      requiredIncludes: ["<functional>", "<vector>", "<utility>", "<string>"],
    };
  }

  generateNativePolyfills(program: ProgramIR, ctx?: PlatformContext): RuntimePolyfillIR[] {
    const helpers: RuntimePolyfillIR[] = [];
    const asyncRuntime = buildAsyncRuntimePolyfill(program, ctx, "generic", this.asyncQueueCapacity(), this);
    if (asyncRuntime) helpers.push(asyncRuntime);
    return helpers;
  }

  asyncLoopInjection(taskVarNames: string[], config: AsyncRuntimeConfig): string[];
  asyncLoopInjection(taskVarNames: string[], hasPromiseRuntime: boolean): string[];
  asyncLoopInjection(taskVarNames: string[], configOrBool: AsyncRuntimeConfig | boolean): string[] {
    let hasPromiseRuntime: boolean;
    if (typeof configOrBool === "boolean") {
      hasPromiseRuntime = configOrBool;
    } else {
      hasPromiseRuntime = configOrBool.hasPromiseRuntime;
    }
    // Drive every async state-machine task once per driver-function iteration.
    // Task globals auto-start on their first .run() (STATE_0 runs
    // unconditionally); the state machine no-ops in its terminal/cyclic state.
    const lines: string[] = [];
    if (hasPromiseRuntime) lines.push("  cuttlefish_pump_microtasks();");
    for (const n of taskVarNames) {
      lines.push(`  ${n}.run();`);
    }
    return lines;
  }
  asyncDriverFunctionName(): string { return "main"; }

  // ── Type aliases ────────────────────────────────────────────────────────

  shouldSkipTypeAlias(_cppType: string): boolean { return false; }

  // ── Diagnostics ─────────────────────────────────────────────────────────

  emitDiagnostics(_emitMode: string): Diagnostic[] { return []; }

  currentTimeMillis(): string {
    return 'std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count()';
  }

  // ── Build configuration ─────────────────────────────────────────────────

  asyncQueueCapacity(): number { return 256; }
  outputSubdirectory(_baseName: string): string { return ".build"; }
  generateHeaderFile(): boolean { return true; }
  enumApiGuard(_enumName: string): { open: string; close: string } | undefined { return undefined; }
  getStdLibSupport(_architecture?: string): StdLibSupport { return DEFAULT_STDLIB_SUPPORT; }

  // ── Debug code generation ─────────────────────────────────────────────────

  debugMode(_target?: string): 'gdb' | 'printf' {
    return 'printf';
  }

  generateDebugInitCode(): string[] {
    return generateGenericInitCode();
  }

  generateDebugBreakpointCode(params: {
    fileName: string; lineNum: number; originalLine: string;
    variables: Array<{ name: string; isFunction?: boolean; cppType?: 'bool' | 'int' | 'long' | 'float' | 'string' | 'unknown' }>;
    normalizedCondition?: string;
    breakpointId?: number;
  }): string[] {
    return generateGenericBreakpointCode(
      params.fileName, params.lineNum, params.originalLine,
      params.variables, params.normalizedCondition, params.breakpointId,
    );
  }

  generateDebugLogpointCode(params: {
    fileName: string; lineNum: number;
    parts: Array<{ type: 'text' | 'variable'; value: string }>;
    variables: Array<{ name: string; isFunction?: boolean; cppType?: 'bool' | 'int' | 'long' | 'float' | 'string' | 'unknown' }>;
  }): string[] {
    return generateGenericLogpointCode(params.fileName, params.lineNum, params.parts, params.variables);
  }

  // ── Graphics (fallback) ────────────────────────────────────────────────

  resolveDisplayOp(_op: DisplayHALOp): { code?: string; expression?: string } | undefined {
    // Generic target has no display hardware. Returning undefined lets the
    // emitter fall back; if a UI is mounted against the generic target the
    // mount-time validation should have already errored.
    return undefined;
  }

  supportedDisplayDrivers(): ReadonlySet<string> {
    return new Set<string>();
  }

  colorFormat(): "rgb565" | "rgb666" | "rgb888" | "mono" {
    return "rgb565";
  }

  graphicsCapacity(): GraphicsCapacity {
    return {
      maxNodes: 256,
      maxBindings: 64,
      maxActiveTransitions: 32,
      nodeStorage: "flash",
    };
  }

  // ── HAL (generic fallback) ──────────────────────────────────────────────
  // The generic/host target has no GPIO or timing hardware. These return
  // documented no-op stubs so emit stays deterministic rather than throwing
  // mid-codegen. Host tests that exercise pin-polling paths use a mock
  // PlatformStrategy (see tests/packages/cuttlefish/async-runtime-static.test.ts).

  readDigitalPin(_pin: string): string {
    return "/* gpio unavailable on generic target */ 0";
  }
  readAnalogPin(_pin: string): string {
    return "/* adc unavailable on generic target */ 0";
  }
  writeDigitalPin(_pin: string, _val: string): string {
    return "/* gpio unavailable on generic target */";
  }
  setPinMode(_pin: string, _mode: string): string {
    return "/* gpio unavailable on generic target */";
  }
  delayMs(_ms: string): string {
    return "/* delay unavailable on generic target */";
  }
  delayMicroseconds(_us: string): string {
    return "/* delay unavailable on generic target */";
  }
  halCallNames(): ReadonlySet<string> {
    return new Set<string>();
  }
  isHalCall(_name: string): boolean {
    return false;
  }
  analogReadCallNames(): ReadonlySet<string> {
    return new Set<string>();
  }
}
