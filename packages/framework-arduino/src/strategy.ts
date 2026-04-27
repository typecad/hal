// ---------------------------------------------------------------------------
// ArduinoStrategy — Arduino framework target (setup/loop, Serial, .ino …)
//
// Absorbs all Arduino-specific emit logic previously scattered across
// cpp-emitter.ts, typecode-map.ts, and arduino-profile.ts.
// ---------------------------------------------------------------------------

import type { PlatformStrategy, ExpressionIR, ProgramIR, Diagnostic, PlatformContext, BoardConstants, TypecodeReceiverKind, RuntimePolyfillIR } from "@typecode/core/shared";
import { resolveArduinoProfile } from "./profile";
import { renderArduinoBuiltin, tryRenderTypecodeCallStatement } from "./typecode-map";

// ---------------------------------------------------------------------------
// Constant sets – previously module-level in cpp-emitter.ts
// ---------------------------------------------------------------------------

/**
 * Names predefined by the Arduino / ESP32 framework as macros or globals.
 * Emitting C++ declarations with these names causes redeclaration errors.
 */
const ARDUINO_RESERVED_NAMES: ReadonlySet<string> = new Set([
  // Standard Arduino digital/analog pin-mode macros (all platforms)
  "HIGH", "LOW", "INPUT", "OUTPUT", "INPUT_PULLUP", "RISING", "FALLING", "CHANGE",
  // ESP32-specific pin-mode macros (esp32-hal-gpio.h)
  "INPUT_PULLDOWN", "OUTPUT_OPEN_DRAIN", "ANALOG",
  // Bus pin aliases (all platforms)
  "SDA", "SCL", "SS", "MOSI", "MISO", "SCK",
  // UART pin aliases — predefined as static const uint8_t on most platforms
  "TX", "RX", "TX2", "RX2",
  // DAC channel aliases — predefined as static const uint8_t on ESP32
  "DAC1", "DAC2",
  // ADC channel aliases — predefined on all Arduino platforms
  "A0", "A1", "A2", "A3", "A4", "A5",
  // Predefined HardwareSerial globals
  "Serial", "Serial2",
  // Arduino.h analog reference macros
  "DEFAULT", "INTERNAL", "EXTERNAL",
  // C++ math macros exposed by Arduino headers
  "min", "max",
  // CMSIS / device-header macros (SAMD21 defines RTC as a register pointer)
  "RTC",
]);

/**
 * Enum member names that conflict with Arduino / ESP32 framework macros.
 * Prefixed with `_` in the emitted enum class body.
 */
const ARDUINO_ENUM_MEMBER_RENAMES: ReadonlySet<string> = new Set([
  "HIGH", "LOW", "INPUT", "OUTPUT", "INPUT_PULLUP",
  "RISING", "FALLING", "CHANGE",
  "INPUT_PULLDOWN", "OUTPUT_OPEN_DRAIN", "ANALOG",
  "DEFAULT", "INTERNAL", "EXTERNAL",
  "RTC",
]);

/**
 * Enum class names already declared as C typedefs in the new Arduino API.
 */
const ARDUINO_API_RESERVED_ENUMS: ReadonlySet<string> = new Set([
  "PinMode", "InterruptMode",
]);

// Shared set of large enum names (values > 16-bit signed int range)
// populated externally via setLargeEnumNames().
let _largeEnumNames: ReadonlySet<string> = new Set();

export class ArduinoStrategy implements PlatformStrategy {
  readonly id = "arduino";

  // Cached profile to avoid repeated arduino-cli calls
  private _cachedProfile: ReturnType<typeof resolveArduinoProfile> | null = null;
  private _cachedProfileKey: string | null = null;
  /** Architecture extracted from FQBN, used for ISR attribute emission. */
  private _cachedArch: string = 'default';

  /**
   * Allows the emitter to inform this strategy which enums have large values
   * so that static_cast uses `long` instead of `int`.
   */
  setLargeEnumNames(names: ReadonlySet<string>): void {
    _largeEnumNames = names;
  }

  /**
   * Clears the cached profile. Should be called between transpilations.
   */
  clearProfileCache(): void {
    this._cachedProfile = null;
    this._cachedProfileKey = null;
    this._cachedArch = 'default';
  }

  /**
   * Gets or resolves the Arduino profile, caching the result.
   */
  private getOrResolveProfile(program: ProgramIR, ctx?: PlatformContext): ReturnType<typeof resolveArduinoProfile> {
    const key = ctx?.arduino?.fqbn ?? 'default';

    if (this._cachedProfile && this._cachedProfileKey === key) {
      return this._cachedProfile;
    }

    this._cachedProfile = resolveArduinoProfile(program, ctx);
    this._cachedProfileKey = key;
    // Cache architecture for use by isrFunctionAttribute()
    const fqbn = ctx?.arduino?.fqbn;
    if (fqbn) {
      const parts = fqbn.split(':');
      this._cachedArch = parts.length >= 2 ? parts[1] : 'default';
    } else {
      this._cachedArch = 'default';
    }
    return this._cachedProfile;
  }

  // ── Profile ─────────────────────────────────────────────────────────────

  forcedIncludes(program: ProgramIR, ctx?: PlatformContext): string[] {
    return this.getOrResolveProfile(program, ctx).forcedIncludes;
  }
  symbolAliases(program: ProgramIR, ctx?: PlatformContext): Record<string, string> {
    return this.getOrResolveProfile(program, ctx).symbolAliases;
  }
  shimLines(program: ProgramIR, ctx?: PlatformContext): string[] {
    return this.getOrResolveProfile(program, ctx).shimLines;
  }
  profileDiagnostics(program: ProgramIR, ctx?: PlatformContext): Diagnostic[] {
    return this.getOrResolveProfile(program, ctx).diagnostics;
  }

  // ── Polyfill overrides ──────────────────────────────────────────────────

  /**
   * Default implementation returns empty set.
   * Board packages can override to provide native implementations.
   */
  nativePolyfills(): Set<string> {
    return new Set(["string_methods", "typecode_halt"]);
  }

  /**
   * Generate native Arduino string method polyfills using Arduino's String class.
   */
  generateNativePolyfills(_program: ProgramIR, _ctx?: PlatformContext): RuntimePolyfillIR[] {
    return [{
      kind: "polyfill",
      id: "typecode_halt",
      domain: "arduino",
      requiredIncludes: [],
      forwardDeclarations: [],
      helperStructs: [],
      helperFunctions: [
        `#ifndef typecode_halt
#define typecode_halt(msg) do { Serial.println(F(msg)); for (;;) {} } while (0)
#endif`,
      ],
      shimMacros: [],
      dependencies: [],
    }, {
      kind: "polyfill",
      id: "string_methods",
      domain: "arduino",
      requiredIncludes: [],
      forwardDeclarations: [],
      helperStructs: [],
      helperFunctions: [
        `#ifndef TYPECODE_STR_BUF_SIZE
#define TYPECODE_STR_BUF_SIZE 64
#endif
// Arduino string method polyfills
bool __tc_endsWith(const char* s, const char* suffix) { int sl = strlen(s), tl = strlen(suffix); return sl >= tl && strcmp(s + sl - tl, suffix) == 0; }
const char* __tc_toUpperCase(const char* s) { static char buf[TYPECODE_STR_BUF_SIZE]; strncpy(buf, s, TYPECODE_STR_BUF_SIZE - 1); buf[TYPECODE_STR_BUF_SIZE - 1] = '\\0'; for (char* p = buf; *p; p++) *p = toupper(*p); return buf; }
const char* __tc_toLowerCase(const char* s) { static char buf[TYPECODE_STR_BUF_SIZE]; strncpy(buf, s, TYPECODE_STR_BUF_SIZE - 1); buf[TYPECODE_STR_BUF_SIZE - 1] = '\\0'; for (char* p = buf; *p; p++) *p = tolower(*p); return buf; }
const char* __tc_trim(const char* s) { while (*s == ' ' || *s == '\\t' || *s == '\\n' || *s == '\\r') s++; int len = strlen(s); while (len > 0 && (s[len-1] == ' ' || s[len-1] == '\\t' || s[len-1] == '\\n' || s[len-1] == '\\r')) len--; static char buf[TYPECODE_STR_BUF_SIZE]; int cplen = len < TYPECODE_STR_BUF_SIZE - 1 ? len : TYPECODE_STR_BUF_SIZE - 1; strncpy(buf, s, cplen); buf[cplen] = '\\0'; return buf; }
const char* __tc_substring2(const char* s, int start, int end) { int slen = strlen(s); if (start < 0) start = 0; if (end > slen) end = slen; if (end < start) end = start; static char buf[TYPECODE_STR_BUF_SIZE]; int len = end - start; if (len >= TYPECODE_STR_BUF_SIZE) len = TYPECODE_STR_BUF_SIZE - 1; strncpy(buf, s + start, len); buf[len] = '\\0'; return buf; }
const char* __tc_substring1(const char* s, int start) { return __tc_substring2(s, start, strlen(s)); }
const char* __tc_slice2(const char* s, int start, int end) { return __tc_substring2(s, start, end); }
const char* __tc_slice1(const char* s, int start) { return __tc_substring2(s, start, strlen(s)); }
const char* __tc_replace(const char* s, const char* old, const char* repl) { static char buf[TYPECODE_STR_BUF_SIZE]; const char* pos = strstr(s, old); if (!pos) { strncpy(buf, s, TYPECODE_STR_BUF_SIZE - 1); buf[TYPECODE_STR_BUF_SIZE - 1] = '\\0'; return buf; } int beforeLen = (int)(pos - s); int oldLen = (int)strlen(old); int replLen = (int)strlen(repl); if (beforeLen + replLen + (int)strlen(pos + oldLen) >= TYPECODE_STR_BUF_SIZE) { strncpy(buf, s, TYPECODE_STR_BUF_SIZE - 1); buf[TYPECODE_STR_BUF_SIZE - 1] = '\\0'; return buf; } memcpy(buf, s, beforeLen); memcpy(buf + beforeLen, repl, replLen); strcpy(buf + beforeLen + replLen, pos + oldLen); return buf; }
const char* __tc_charAt(const char* s, int idx) { static char buf[2]; buf[0] = s[idx]; buf[1] = '\\0'; return buf; }
int __tc_charCodeAt(const char* s, int idx) { return (int)(unsigned char)s[idx]; }
`],
      shimMacros: [],
      dependencies: [],
    }];
  }

  /**
   * Default implementation returns empty array.
   * Board packages can override to provide setup initialization code.
   */
  setupInitCode(_program: ProgramIR, _ctx?: PlatformContext): string[] {
    return [];
  }

  // ── File shape ──────────────────────────────────────────────────────────

  sourceExtension(isEntryFile: boolean, isNpmPackage: boolean): string {
    if (isNpmPackage) return "cpp";
    if (isEntryFile) return "ino";
    return "h";
  }
  entrypointFunctionName(): string {
    return "setup";
  }
  requiresLoopFunction(): boolean {
    return true;
  }
  overrideBaseName(originalBaseName: string, outDirBaseName: string, isEntryFile: boolean, isNpmPackage: boolean): string {
    // Arduino .ino files must match the containing directory name
    return (!isNpmPackage && isEntryFile) ? outDirBaseName : originalBaseName;
  }
  effectiveEmitMode(_requestedMode: string, isNpmPackage: boolean): string {
    return isNpmPackage ? _requestedMode : "cpp";
  }

  // ── Type normalisation ──────────────────────────────────────────────────

  defaultNumericType(): string { return "int"; }
  normalizeCppType(typeName: string): string {
    if (typeName === "auto") return "int";
    if (typeName === "std::string") return "const char*";
    if (typeName === "IInputModePin" || typeName === "IOutputModePin" || typeName === "IPin") return "int";
    const fnTypeMatch = typeName.match(/^std::function<\s*([^()<>]+)\((.*)\)\s*>$/);
    if (fnTypeMatch) {
      const returnType = fnTypeMatch[1].trim();
      const params = fnTypeMatch[2].trim();
      return `${returnType} (*)(${params})`;
    }
    return typeName;
  }
  mapReturnType(functionName: string, returnType: string): string {
    if (functionName === "setup" || functionName === "loop") return "void";
    return this.normalizeCppType(returnType);
  }
  mapFunctionName(originalName: string): string {
    if (originalName === "void" || originalName === "__arduino_setup__") return "setup";
    return originalName;
  }

  // ── Expression rendering ────────────────────────────────────────────────

  currentTimeMillis(): string { return "millis()"; }

  // Apply regex transformations to raw expression text.
  // NOTE: String method regexes (toUpperCase, includes, etc.) assume the receiver
  // is a string (const char*). Array methods (indexOf, push, etc.) are handled at
  // the IR level in expression-to-ir.ts where type context is available.
  normalizeRawExpression(value: string): string {
    let v = value;
    v = v.replace(/\bPinMode::(HIGH|LOW|INPUT|OUTPUT|INPUT_PULLUP)\b/g, "PinMode::_$1");
    v = v.replace(/\bPinMode::(_?[A-Z_]+)\b/g, "static_cast<int>(PinMode::$1)");
    v = v.replace(/(->|\.)capabilities\.interrupt\b/g, "$1capabilities");
    v = v.replace(
      /\bstd::(floor|ceil|round|trunc|sqrt|pow|sin|cos|tan|asin|acos|atan|abs|max|min)\b/g,
      "$1",
    );
    v = v.replace(/\bDate\.now\(\)/g, "millis()");
    v = v.replace(/\bundefined\b/g, "TYPECODE_UNDEFINED");
    v = v.replace(/\bnull\b/g, "TYPECODE_UNDEFINED");

    // String method transformations for Arduino (const char* → String wrapper calls)
    // Mutating methods that return void in Arduino are wrapped in helper functions
    v = v.replace(/(\w+)\.toUpperCase\(\)/g, "__tc_toUpperCase($1)");
    v = v.replace(/(\w+)\.toLowerCase\(\)/g, "__tc_toLowerCase($1)");
    v = v.replace(/(\w+)\.trim\(\)/g, "__tc_trim($1)");
    v = v.replace(/(\w+)\.includes\(([^)]+)\)/g, "(strstr($1, $2) != NULL)");
    v = v.replace(/(\w+)\.startsWith\(([^)]+)\)/g, "(strncmp($1, $2, strlen($2)) == 0)");
    v = v.replace(/(\w+)\.endsWith\(([^)]+)\)/g, "__tc_endsWith($1, $2)");
    v = v.replace(/(\w+)\.substring\(([^,]+),\s*([^)]+)\)/g, "__tc_substring2($1, $2, $3)");
    v = v.replace(/(\w+)\.substring\(([^)]+)\)/g, "__tc_substring1($1, $2)");
    v = v.replace(/(\w+)\.slice\(([^,]+),\s*([^)]+)\)/g, "__tc_slice2($1, $2, $3)");
    v = v.replace(/(\w+)\.slice\(([^)]+)\)/g, "__tc_slice1($1, $2)");
    v = v.replace(/(\w+)\.replace\(([^,]+),\s*([^)]+)\)/g, "__tc_replace($1, $2, $3)");
    v = v.replace(/(\w+)\.charAt\(([^)]+)\)/g, "__tc_charAt($1, $2)");
    v = v.replace(/(\w+)\.charCodeAt\(([^)]+)\)/g, "__tc_charCodeAt($1, $2)");

    return v;
  }
  nullValue(): string {
    return "TYPECODE_UNDEFINED";
  }
  mapPeripheralIdentifier(name: string): string | undefined {
    if (/^I2C\d+$/.test(name)) {
      const num = name.slice(3);
      return num === '0' ? 'Wire' : `Wire${num}`;
    }
    if (/^SPI\d+$/.test(name)) {
      const num = name.slice(3);
      return num === '0' ? 'SPI' : `SPI${num}`;
    }
    if (/^UART\d+$/.test(name)) {
      const num = name.slice(4);
      return num === '0' ? 'Serial' : `Serial${num}`;
    }
    return undefined;
  }
  wrapStringConcat(leftRendered: string, rightRendered: string, leftIsString: boolean): string | undefined {
    // When snprintf mode is active, string concat is handled at the expression
    // renderer level — no String() wrapping needed here.
    if (this.useSnprintfForStrings()) {
      return undefined;
    }
    if (leftIsString) {
      return `String(${leftRendered}) + ${rightRendered}`;
    }
    return undefined;
  }
  useSnprintfForStrings(): boolean {
    return true;
  }
  floatToSnprintfArg(
    renderedExpr: string,
    precision: number | undefined,
    tempId: number,
  ): { format: string; arg: string; estimatedLength: number; preludeLines: string[] } {
    const effectivePrecision = precision ?? 6;
    const bufferName = `__typecode_float_${tempId}`;
    const estimatedLength = Math.max(16, effectivePrecision + 8);
    return {
      format: "%s",
      arg: bufferName,
      estimatedLength,
      preludeLines: [
        `char ${bufferName}[${estimatedLength}];`,
        `dtostrf(${renderedExpr}, 0, ${effectivePrecision}, ${bufferName});`,
      ],
    };
  }
  renameEnumMember(_enumName: string, memberName: string): string {
    return ARDUINO_ENUM_MEMBER_RENAMES.has(memberName) ? `_${memberName}` : memberName;
  }
  enumCastType(enumName: string): string | undefined {
    return _largeEnumNames.has(enumName) ? "long" : "int";
  }
  tryRenderTypecodeCall(
    receiver: string,
    receiverKind: TypecodeReceiverKind,
    method: string,
    args: ReadonlyArray<ExpressionIR>,
    renderArg: (e: ExpressionIR) => string,
    boardConstants?: BoardConstants,
    interruptMode?: "FALLING" | "RISING" | "CHANGE",
  ): string | undefined {
    // First try the standard pin/peripheral built-ins
    const builtin = renderArduinoBuiltin(receiver, receiverKind, method, args, renderArg, boardConstants, interruptMode);
    if (builtin !== undefined) return builtin;

    // Try the statement-level handler for all typecode calls
    // This handles config chains (D13.config.output), interrupts (D2.onFalling), etc.
    const callee = `${receiver}.${method}`;
    const statementResult = tryRenderTypecodeCallStatement(callee, args, "arduino", renderArg, boardConstants);
    if (statementResult !== undefined) return statementResult;

    return undefined;
  }
  renderBoardDefinitionAccess(
    chain: string[],
    boardConstants?: BoardConstants,
  ): string | undefined {
    if (chain.length < 3) return undefined;
    if (chain[0] !== "Board" && chain[0] !== "Pins") return undefined;
    if (chain[1] !== "definition") return undefined;
    if (!boardConstants) return undefined;
    const dotPath = chain.slice(2).join(".");
    const value = boardConstants.get(dotPath);
    if (value === undefined) return undefined;
    return typeof value === "string" ? `"${value}"` : `${value}`;
  }

  // ── Statement rendering ─────────────────────────────────────────────────

  tryRenderCallStatement(
    callee: string,
    args: ReadonlyArray<ExpressionIR>,
    renderArg: (e: ExpressionIR) => string,
    boardConstants?: BoardConstants,
  ): string | undefined {
    return tryRenderTypecodeCallStatement(callee, args, "arduino", renderArg, boardConstants) ?? undefined;
  }
  renderThrow(_valueExpr: string): string {
    return "typecode_halt(\"PANIC\")";
  }
  transformConsoleCall(method: string, renderedArgs: string, forHeader: boolean): string {
    const semi = forHeader ? "" : ";";
    // Wrap bare string literals with F() to store them in program memory
    const isBareLiteral = /^"[^"]*"$/.test(renderedArgs);
    const safeArgs = isBareLiteral ? `F(${renderedArgs})` : renderedArgs;
    switch (method) {
      case "log":
        return `Serial.println(${safeArgs})${semi}`;
      case "error":
        return `Serial.print(F("[ERROR] ")); Serial.println(${safeArgs})${semi}`;
      case "warn":
        return `Serial.print(F("[WARN] ")); Serial.println(${safeArgs})${semi}`;
      case "info":
        return `Serial.print(F("[INFO] ")); Serial.println(${safeArgs})${semi}`;
      case "debug":
        return `Serial.print(F("[DEBUG] ")); Serial.println(${safeArgs})${semi}`;
      default:
        return `Serial.println(${safeArgs})${semi}`;
    }
  }
  objectFieldInitializer(fieldValue: ExpressionIR, _renderExpr: (e: ExpressionIR) => string): string | undefined {
    // Nested objects are now supported with proper nested struct definitions
    return undefined;
  }
  overrideClassFieldType(fieldName: string, normalizedType: string): string {
    // _interruptHandler is a function pointer on Arduino
    if (fieldName === "_interruptHandler" && normalizedType === "int") {
      return "void (*)(void)";
    }
    return normalizedType;
  }

  // ── Name guards ─────────────────────────────────────────────────────────

  reservedNames(): ReadonlySet<string> {
    return ARDUINO_RESERVED_NAMES;
  }
  apiReservedEnumNames(): ReadonlySet<string> {
    return ARDUINO_API_RESERVED_ENUMS;
  }
  apiReservedEnumGuard(): string {
    return "ARDUINO_API_VERSION";
  }

  // ── Includes ────────────────────────────────────────────────────────────

  needsIostream(): boolean { return false; }
  needsStdString(): boolean { return false; }
  needsStdVector(): boolean { return false; }
  needsStdExcept(): boolean { return false; }
  needsStdFunction(): boolean { return false; }
  mathHeader(): string { return "<math.h>"; }
  needsVectorOverload(): boolean { return false; }

  // ── Enum underlying type ────────────────────────────────────────────────

  needsLargeEnumUnderlying(): boolean { return true; }

  // ── Struct field handling ───────────────────────────────────────────────

  renameStructField(fieldName: string): string {
    return ARDUINO_RESERVED_NAMES.has(fieldName) ? `_${fieldName}` : fieldName;
  }
  structFieldInitializer(
    fieldValue: ExpressionIR,
    compiletimeVarNames: Set<string>,
    _renderExpr: (e: ExpressionIR) => string,
  ): string | undefined {
    // Nested object literals are now supported with proper struct definitions
    // so they should render normally as aggregate initializers.
    if (fieldValue.kind === "identifier") {
      const identName = fieldValue.value;
      if (!compiletimeVarNames.has(identName)) return "0";
    }
    return undefined;
  }

  // ── Async ───────────────────────────────────────────────────────────────

  asyncLoopInjection(taskVarNames: string[], hasPromiseRuntime: boolean): string[] {
    const lines: string[] = [];
    for (const n of taskVarNames) {
      lines.push(`  ${n}.run();`);
    }
    if (hasPromiseRuntime) lines.push("  typecode_pump_microtasks();");
    return lines;
  }
  asyncDriverFunctionName(): string { return "loop"; }

  /**
   * On ESP32 (Xtensa LX6/LX7), ISR functions must be placed in IRAM so they
   * can execute while the SPI flash cache is busy.  Other architectures don't
   * need this attribute.
   */
  isrFunctionAttribute(): string {
    return this._cachedArch === 'esp32' ? 'IRAM_ATTR ' : '';
  }

  // ── Type aliases ────────────────────────────────────────────────────────

  shouldSkipTypeAlias(cppType: string): boolean {
    return cppType.includes("std::string");
  }

  // ── Diagnostics ─────────────────────────────────────────────────────────

  emitDiagnostics(_emitMode: string): Diagnostic[] {
    // Split mode info message removed - Arduino inherently uses .ino format
    return [];
  }

  // ── Interrupt safety ────────────────────────────────────────────────────

  isrUnsafeOperations(): Map<string, { reason: string; severity: 'warning' | 'info' }> {
    return new Map([
      ['delay', { reason: 'delay() blocks the CPU and should not be used in interrupt context', severity: 'warning' }],
      ['delayMicroseconds', { reason: 'delayMicroseconds() blocks and should be avoided in ISRs', severity: 'warning' }],
      ['Serial.print', { reason: 'Serial.print() may not work correctly in interrupt context', severity: 'info' }],
      ['Serial.println', { reason: 'Serial.println() may not work correctly in interrupt context', severity: 'info' }],
      ['Serial.write', { reason: 'Serial.write() may not work correctly in interrupt context', severity: 'info' }],
      ['Serial.read', { reason: 'Serial.read() may not work correctly in interrupt context', severity: 'info' }],
      ['I2C0', { reason: 'I2C operations can cause lockups in interrupt context', severity: 'warning' }],
      ['I2C1', { reason: 'I2C operations can cause lockups in interrupt context', severity: 'warning' }],
      ['SPI0', { reason: 'SPI operations may cause issues in interrupt context', severity: 'info' }],
      ['SPI1', { reason: 'SPI operations may cause issues in interrupt context', severity: 'info' }],
    ]);
  }
}