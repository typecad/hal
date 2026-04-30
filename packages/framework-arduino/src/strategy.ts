// ---------------------------------------------------------------------------
// ArduinoStrategy — Arduino framework target (setup/loop, Serial, .ino …)
//
// Absorbs all Arduino-specific emit logic previously scattered across
// cpp-emitter.ts, typehal-map.ts, and arduino-profile.ts.
// ---------------------------------------------------------------------------

import type { PlatformStrategy, ExpressionIR, ProgramIR, Diagnostic, PlatformContext, BoardConstants, TypehalReceiverKind, RuntimePolyfillIR, StdLibSupport } from "@typehal/core/shared";
import type { StatementIR } from "@typehal/core/shared";
import { generateSerialInitCode, generateBreakpointCode, generateLogpointCode } from "./debug-codegen";
import { resolveArduinoProfile } from "./profile";
import { renderArduinoBuiltin, tryRenderTypehalCallStatement } from "./typehal-map";
import { renderDACCall } from "./handlers/dac-handler";

/**
 * Arduino-specific platform context.
 * Accessed via `PlatformContext` index signature: `arduinoCtx(ctx)`.
 */
export interface ArduinoPlatformContext {
  buildTarget?: string;
}

function arduinoCtx(ctx?: PlatformContext): ArduinoPlatformContext | undefined {
  const data = ctx?.frameworkData as { buildTarget?: string } | undefined;
  return data ?? undefined;
}

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
 * Arduino macros that are used as VALUE constants in TypeHAL code
 * (e.g. HIGH, LOW, OUTPUT). These map to themselves via mapPeripheralIdentifier
 * so they bypass escapeCppKeyword. Function-like macros (min, max) are excluded
 * because user variables with those names must remain escaped in expressions.
 */
const ARDUINO_CONSTANT_MACROS: ReadonlySet<string> = new Set([
  "HIGH", "LOW",
  "INPUT", "OUTPUT", "INPUT_PULLUP",
  "RISING", "FALLING", "CHANGE",
  "INPUT_PULLDOWN", "OUTPUT_OPEN_DRAIN", "ANALOG",
  "SDA", "SCL", "SS", "MOSI", "MISO", "SCK",
  "TX", "RX", "TX2", "RX2",
  "DAC1", "DAC2",
  "A0", "A1", "A2", "A3", "A4", "A5",
  "DEFAULT", "INTERNAL", "EXTERNAL",
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
  /** Track whether the current program uses createPinGroup() */
  private _usesPinGroup: boolean = false;

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
    const key = arduinoCtx(ctx)?.buildTarget ?? 'default';

    if (this._cachedProfile && this._cachedProfileKey === key) {
      return this._cachedProfile;
    }

    this._cachedProfile = resolveArduinoProfile(program, ctx);
    this._cachedProfileKey = key;
    // Cache architecture for use by isrFunctionAttribute()
    const buildTarget = arduinoCtx(ctx)?.buildTarget;
    if (buildTarget) {
      const parts = buildTarget.split(':');
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
    this._usesPinGroup = detectPinGroupUsage(program);
    const lines = this.getOrResolveProfile(program, ctx).shimLines;

    if (this._usesPinGroup) {
      lines.push(
        "// PinGroup polyfill",
        "struct __tc_PinGroup {",
        "    const int* pins;",
        "    int count;",
        "    void writePattern(int pattern) const {",
        "        for (int i = 0; i < count; i++) {",
        "            digitalWrite(pins[i], (pattern >> i) & 1 ? HIGH : LOW);",
        "        }",
        "    }",
        "    int readPattern() const {",
        "        int value = 0;",
        "        for (int i = 0; i < count; i++) {",
        "            if (digitalRead(pins[i]) == HIGH) {",
        "                value |= (1 << i);",
        "            }",
        "        }",
        "        return value;",
        "    }",
        "    void fill(bool value) const {",
        "        for (int i = 0; i < count; i++) {",
        "            digitalWrite(pins[i], value ? HIGH : LOW);",
        "        }",
        "    }",
        "};",
        "template<typename... Args>",
        "__tc_PinGroup __tc_createPinGroup(Args... args) {",
        "    static const int pins[] = { args... };",
        "    for(int i=0; i<sizeof...(args); i++) pinMode(pins[i], OUTPUT);",
        "    return __tc_PinGroup{pins, sizeof...(args)};",
        "}"
      );
    }
    return lines;
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
    return new Set(["string_methods", "typehal_halt"]);
  }

  /**
   * Generate native helpers: typehal_halt macro, Arduino string helpers,
   * and (when stdlib supports it) the cooperative async Promise runtime.
   */
  generateNativePolyfills(program: ProgramIR, ctx?: PlatformContext): RuntimePolyfillIR[] {
    const helpers: RuntimePolyfillIR[] = [{
      kind: "polyfill",
      id: "typehal_halt",
      domain: "arduino",
      requiredIncludes: [],
      forwardDeclarations: [],
      helperStructs: [],
      helperFunctions: [
        `#ifndef typehal_halt
#define typehal_halt(msg) do { Serial.println(F(msg)); for (;;) {} } while (0)
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
        `#ifndef TYPEHAL_STR_BUF_SIZE
#define TYPEHAL_STR_BUF_SIZE 64
#endif
// Arduino string method polyfills
bool __tc_endsWith(const char* s, const char* suffix) { int sl = strlen(s), tl = strlen(suffix); return sl >= tl && strcmp(s + sl - tl, suffix) == 0; }
const char* __tc_toUpperCase(const char* s) { static char buf[2][TYPEHAL_STR_BUF_SIZE]; static uint8_t slot = 0; slot ^= 1; char* b = buf[slot]; strncpy(b, s, TYPEHAL_STR_BUF_SIZE - 1); b[TYPEHAL_STR_BUF_SIZE - 1] = '\\0'; for (char* p = b; *p; p++) *p = toupper(*p); return b; }
const char* __tc_toLowerCase(const char* s) { static char buf[2][TYPEHAL_STR_BUF_SIZE]; static uint8_t slot = 0; slot ^= 1; char* b = buf[slot]; strncpy(b, s, TYPEHAL_STR_BUF_SIZE - 1); b[TYPEHAL_STR_BUF_SIZE - 1] = '\\0'; for (char* p = b; *p; p++) *p = tolower(*p); return b; }
const char* __tc_trim(const char* s) { static char buf[2][TYPEHAL_STR_BUF_SIZE]; static uint8_t slot = 0; slot ^= 1; char* b = buf[slot]; while (*s == ' ' || *s == '\\t' || *s == '\\n' || *s == '\\r') s++; int len = strlen(s); while (len > 0 && (s[len-1] == ' ' || s[len-1] == '\\t' || s[len-1] == '\\n' || s[len-1] == '\\r')) len--; int cplen = len < TYPEHAL_STR_BUF_SIZE - 1 ? len : TYPEHAL_STR_BUF_SIZE - 1; strncpy(b, s, cplen); b[cplen] = '\\0'; return b; }
const char* __tc_substring2(const char* s, int start, int end) { static char buf[2][TYPEHAL_STR_BUF_SIZE]; static uint8_t slot = 0; slot ^= 1; char* b = buf[slot]; int slen = strlen(s); if (start < 0) start = 0; if (end > slen) end = slen; if (end < start) end = start; int len = end - start; if (len >= TYPEHAL_STR_BUF_SIZE) len = TYPEHAL_STR_BUF_SIZE - 1; strncpy(b, s + start, len); b[len] = '\\0'; return b; }
const char* __tc_substring1(const char* s, int start) { return __tc_substring2(s, start, strlen(s)); }
const char* __tc_slice2(const char* s, int start, int end) { return __tc_substring2(s, start, end); }
const char* __tc_slice1(const char* s, int start) { return __tc_substring2(s, start, strlen(s)); }
const char* __tc_replace(const char* s, const char* old, const char* repl) { static char buf[2][TYPEHAL_STR_BUF_SIZE]; static uint8_t slot = 0; slot ^= 1; char* b = buf[slot]; const char* pos = strstr(s, old); if (!pos) { strncpy(b, s, TYPEHAL_STR_BUF_SIZE - 1); b[TYPEHAL_STR_BUF_SIZE - 1] = '\\0'; return b; } int beforeLen = (int)(pos - s); int oldLen = (int)strlen(old); int replLen = (int)strlen(repl); if (beforeLen + replLen + (int)strlen(pos + oldLen) >= TYPEHAL_STR_BUF_SIZE) { strncpy(b, s, TYPEHAL_STR_BUF_SIZE - 1); b[TYPEHAL_STR_BUF_SIZE - 1] = '\\0'; return b; } memcpy(b, s, beforeLen); memcpy(b + beforeLen, repl, replLen); strcpy(b + beforeLen + replLen, pos + oldLen); return b; }
const char* __tc_charAt(const char* s, int idx) { static char buf[2][2]; static uint8_t slot = 0; slot ^= 1; buf[slot][0] = s[idx]; buf[slot][1] = '\\0'; return buf[slot]; }
int __tc_charCodeAt(const char* s, int idx) { return (int)(unsigned char)s[idx]; }
`],
      shimMacros: [],
      dependencies: [],
    }];

    // Add async Promise runtime if program has async functions and stdlib supports it
    const hasAsync = program.functions.some(fn => fn.isAsync);
    if (hasAsync) {
      const architecture = ctx?.architecture ?? arduinoCtx(ctx)?.buildTarget?.split(":")?.[1]?.toLowerCase();
      const stdlib = this.getStdLibSupport(architecture);
      if (stdlib.hasVector && stdlib.hasString) {
        helpers.push({
          kind: "polyfill",
          id: "async_runtime",
          domain: "arduino",
          requiredIncludes: ["<functional>", "<vector>", "<utility>", "<string>"],
          forwardDeclarations: [],
          helperStructs: [generatePromiseRuntime(arduinoCtx(ctx)?.buildTarget?.split(":")?.[0] === "arduino" ? "arduino" : "generic")],
          helperFunctions: [],
          shimMacros: [],
          dependencies: [],
          hasPromiseRuntime: true,
        } as RuntimePolyfillIR & { hasPromiseRuntime: boolean });
      }
    }

    // Add blocking pin-edge polyfill for constrained targets (AVR) when waitForRising/Falling is used.
    if (detectWaitForPinEdgeUsage(program)) {
      const architecture = ctx?.architecture ?? arduinoCtx(ctx)?.buildTarget?.split(":")?.[1]?.toLowerCase();
      const stdlib = this.getStdLibSupport(architecture);
      if (!(stdlib.hasVector && stdlib.hasString)) {
        helpers.push({
          kind: "polyfill",
          id: "avr_pin_edge_blocking",
          domain: "arduino",
          requiredIncludes: [],
          forwardDeclarations: [],
          helperStructs: [],
          helperFunctions: [AVR_PIN_EDGE_BLOCKING_POLYFILL],
          shimMacros: [],
          dependencies: [],
        });
      }
    }

    return helpers;
  }

  /**
   * Injects Serial.begin(baudRate) at the top of setup() when the program uses
   * console.* calls and has a baudRate configured, and no explicit .begin() call
   * is already present.
   */
  setupInitCode(program: ProgramIR, ctx?: PlatformContext): string[] {
    const baudRate = ctx?.console?.baudRate;
    if (!baudRate) return [];
    const analysis = (ctx as any)?.analysis as { hasConsoleCalls?: boolean; hasSerialBegin?: boolean } | undefined;
    if (analysis) {
      if (!analysis.hasConsoleCalls) return [];
      if (analysis.hasSerialBegin) return [];
    } else {
      // Fallback: walk IR if no pre-computed analysis available
      if (!detectConsoleUsage(program)) return [];
      if (!detectSerialBeginCall(program)) return [];
    }
    return [`Serial.begin(${baudRate});`];
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
    if (typeName === "auto") return "auto";
    if (typeName === "std::string") return "const char*";
    if (typeName === "IInputModePin" || typeName === "IOutputModePin" || typeName === "IPin") return "int";
    if (this._usesPinGroup && typeName.startsWith("IPinGroup")) return "__tc_PinGroup";
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
    if (originalName === "void" || originalName === "__typehal_entrypoint__") return "setup";
    return originalName;
  }

  // ── Expression rendering ────────────────────────────────────────────────

  currentTimeMillis(): string { return "millis()"; }

  isSerialPeripheral(name: string): boolean {
    return /^Serial\d*$/.test(name);
  }

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
    v = v.replace(/\bundefined\b/g, "TYPEHAL_UNDEFINED");
    v = v.replace(/\bnull\b/g, "TYPEHAL_UNDEFINED");

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

    if (this._usesPinGroup) {
      v = v.replace(/createPinGroup\(\{\s*(.*?)\s*\}\)/g, '__tc_createPinGroup($1)');
    }

    return v;
  }
  nullValue(): string {
    return "TYPEHAL_UNDEFINED";
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
    // Arduino constant macros (HIGH, LOW, INPUT, OUTPUT, etc.) are predefined
    // by the framework headers — return as-is to prevent escapeCppKeyword from
    // suffixing them with '_'.  User variables sharing these names are escaped
    // at the declaration site; the mapping here only fires when the identifier
    // is the original (un-escaped) macro name used as a value.
    if (ARDUINO_CONSTANT_MACROS.has(name)) {
      return name;
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
    const bufferName = `__typehal_float_${tempId}`;
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
  tryRenderTypehalCall(
    receiver: string,
    receiverKind: TypehalReceiverKind,
    method: string,
    args: ReadonlyArray<ExpressionIR>,
    renderArg: (e: ExpressionIR) => string,
    boardConstants?: BoardConstants,
    interruptMode?: "FALLING" | "RISING" | "CHANGE",
  ): string | undefined {
    // First try the standard pin/peripheral built-ins
    // DAC1/DAC2 are mapped as 'pwm' by inferKindByName — intercept and route to DAC handler
    if ((receiver === 'DAC1' || receiver === 'DAC2') && (method === 'write' || method === 'disable')) {
      if (this._cachedArch === 'esp32') {
        return renderDACCall(receiver, method, args, renderArg);
      }
      return `/* DAC output is not available on this architecture */`;
    }
    // Architecture-aware override: PWM setFrequency
    if (receiverKind === 'pwm' && method === 'setFrequency') {
      const pin = /^D(\d+)$/.test(receiver) ? receiver.slice(1) : receiver;
      const freq = args[0] !== undefined ? renderArg(args[0]) : '0';
      if (this._cachedArch === 'esp32') {
        return `analogWriteFrequency(${pin}, ${freq})`;
      }
      return `/* setFrequency() not supported on this architecture (${receiver}) */`;
    }
    const builtin = renderArduinoBuiltin(receiver, receiverKind, method, args, renderArg, boardConstants, interruptMode);
    if (builtin !== undefined) return builtin;

    // Try the statement-level handler for all typehal calls
    // This handles config chains (D13.config.output), interrupts (D2.onFalling), etc.
    const callee = `${receiver}.${method}`;
    const statementResult = tryRenderTypehalCallStatement(callee, args, "arduino", renderArg, boardConstants, this._cachedArch);
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

  resolvePinType(objectName: string, fieldName: string): string | undefined {
    if (objectName !== "Pins") return undefined;
    if (fieldName === "D2") return "AVRInterruptPin*";
    if (fieldName === "D3") return "AVRPWMInterruptPin*";
    if (["D5", "D6", "D9", "D10", "D11"].includes(fieldName)) return "AVRPWMPin*";
    if (/^A\d+$/.test(fieldName)) return "AVRAnalogPin*";
    if (/^D\d+$/.test(fieldName) || fieldName === "LED") return "AVRDigitalPin*";
    return undefined;
  }

  // ── Statement rendering ─────────────────────────────────────────────────

  tryRenderCallStatement(
    callee: string,
    args: ReadonlyArray<ExpressionIR>,
    renderArg: (e: ExpressionIR) => string,
    boardConstants?: BoardConstants,
  ): string | undefined {
    return tryRenderTypehalCallStatement(callee, args, "arduino", renderArg, boardConstants, this._cachedArch) ?? undefined;
  }
  renderThrow(_valueExpr: string): string {
    return "typehal_halt(\"PANIC\")";
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

  renderSerialPrintWithSnprintf(params: {
    receiver: string;
    method: string;
    bufferName: string;
  }): { finalLine: string } | undefined {
    const serialInstance = params.receiver.startsWith("UART")
      ? params.receiver.slice(4) === "0" ? "Serial" : `Serial${params.receiver.slice(4)}`
      : params.receiver.startsWith("Serial")
        ? params.receiver
        : "Serial";
    return {
      finalLine: `${serialInstance}.${params.method}(${params.bufferName});`,
    };
  }

  renderI2CDeviceRead(params: {
    receiver: string;
    wireName: string;
    address: string;
    register: string;
    count?: string;
    targetVarName: string;
  }): { preludeLines: string[]; returnValue: string; isMultiStatement?: boolean } | undefined {
    const wire = params.wireName;
    if (params.count) {
      // readBytes: declare a uint8_t array and fill it via a read loop
      return {
        preludeLines: [
          `uint8_t ${params.targetVarName}[${params.count}];`,
          `${wire}.beginTransmission(${params.address});`,
          `${wire}.write(${params.register});`,
          `${wire}.endTransmission(false);`,
          `${wire}.requestFrom(${params.address}, ${params.count});`,
          `for (int i = 0; i < ${params.count}; i++) { ${params.targetVarName}[i] = ${wire}.read(); }`,
        ],
        returnValue: "",
        isMultiStatement: true,
      };
    }
    // readByte: emit Wire setup as prelude, keep Wire.read() as the variable initializer
    return {
      preludeLines: [
        `${wire}.beginTransmission(${params.address});`,
        `${wire}.write(${params.register});`,
        `${wire}.endTransmission(false);`,
        `${wire}.requestFrom(${params.address}, 1);`,
      ],
      returnValue: `${wire}.read()`,
    };
  }

  // ── Name guards ─────────────────────────────────────────────────────────

  forwardDeclarationExclusions(): string[] {
    return ["setup", "loop", "main"];
  }

  ambientTypeDeclarations(): string[] {
    return [
      "",
      "  // Timing utilities (transpiled to millis/micros/delay/delayMicroseconds)",
      "  const Timing: {",
      "    millis(): number;",
      "    micros(): number;",
      "    delay(ms: number): void;",
      "    delayMicroseconds(us: number): void;",
      "  };",
      "",
      "  // EEPROM non-volatile storage (transpiled to EEPROM.*)",
      "  const EEPROM: {",
      "    read(addr: number): number;",
      "    write(addr: number, value: number): void;",
      "    update(addr: number, value: number): void;",
      "    length(): number;",
      "    get<T>(addr: number, ref: T): T;",
      "    put<T>(addr: number, ref: T): void;",
      "  };",
      "",
      "  // Watchdog timer (transpiled to wdt_enable/wdt_reset/wdt_disable)",
      "  const WDT: {",
      "    enable(timeout?: '15ms' | '30ms' | '60ms' | '120ms' | '250ms' | '500ms' | '1s' | '2s' | '4s' | '8s'): void;",
      "    reset(): void;",
      "    disable(): void;",
      "  };",
      "",
      "  // Key-value non-volatile storage (EEPROM-backed on AVR, native Preferences.h on ESP32)",
      "  const Preferences: {",
      "    begin(name: string, readOnly?: boolean): void;",
      "    end(): void;",
      "    putInt(key: string, value: number): void;",
      "    getInt(key: string, defaultValue: number): number;",
      "    putUInt(key: string, value: number): void;",
      "    getUInt(key: string, defaultValue: number): number;",
      "    putBool(key: string, value: boolean): void;",
      "    getBool(key: string, defaultValue: boolean): boolean;",
      "    putFloat(key: string, value: number): void;",
      "    getFloat(key: string, defaultValue: number): number;",
      "    putString(key: string, value: string): void;",
      "    getString(key: string, defaultValue: string): string;",
      "    clear(): void;",
      "    remove(key: string): void;",
      "  };",
    ];
  }

  reservedNames(): ReadonlySet<string> {
    return ARDUINO_RESERVED_NAMES;
  }
  apiReservedEnumNames(): ReadonlySet<string> {
    return ARDUINO_API_RESERVED_ENUMS;
  }
  apiReservedEnumGuard(): string {
    return "ARDUINO_API_VERSION";
  }

  isHeapAllocationUnsafe(architecture: string): boolean {
    return architecture === 'avr' || architecture === 'megaavr';
  }

  isExceptionSupportDisabled(architecture: string): boolean {
    return architecture === 'avr' || architecture === 'megaavr';
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
    if (hasPromiseRuntime) lines.push("  typehal_pump_microtasks();");
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

  // ── Build configuration ──────────────────────────────────────────────────

  asyncQueueCapacity(): number { return 32; }
  outputSubdirectory(baseName: string): string { return baseName; }
  generateHeaderFile(): boolean { return false; }
  enumApiGuard(_enumName: string): { open: string; close: string } | undefined {
    return { open: "#if !defined(ARDUINO_API_VERSION)", close: "#endif // !defined(ARDUINO_API_VERSION)" };
  }

  private static readonly STDLIB_SUPPORT: Record<string, StdLibSupport> = {
    avr: {
      hasVector: false, hasString: false, hasIostream: false,
      hasExceptions: false, hasRTTI: false,
      recommendedArrayImpl: "static_array", recommendedStringImpl: "static_string",
    },
    esp32: {
      hasVector: true, hasString: true, hasIostream: true,
      hasExceptions: true, hasRTTI: true,
      recommendedArrayImpl: "std_vector", recommendedStringImpl: "std_string",
    },
    esp8266: {
      hasVector: true, hasString: true, hasIostream: true,
      hasExceptions: true, hasRTTI: true,
      recommendedArrayImpl: "std_vector", recommendedStringImpl: "std_string",
    },
    rp2040: {
      hasVector: true, hasString: true, hasIostream: true,
      hasExceptions: true, hasRTTI: true,
      recommendedArrayImpl: "std_vector", recommendedStringImpl: "std_string",
    },
    samd: {
      hasVector: true, hasString: true, hasIostream: true,
      hasExceptions: true, hasRTTI: true,
      recommendedArrayImpl: "std_vector", recommendedStringImpl: "std_string",
    },
    megaavr: {
      hasVector: false, hasString: false, hasIostream: false,
      hasExceptions: false, hasRTTI: false,
      recommendedArrayImpl: "static_array", recommendedStringImpl: "static_string",
    },
  };

  getStdLibSupport(architecture?: string): StdLibSupport {
    if (!architecture) return ArduinoStrategy.DEFAULT_STDLIB;
    return ArduinoStrategy.STDLIB_SUPPORT[architecture.toLowerCase()] ?? ArduinoStrategy.DEFAULT_STDLIB;
  }

  private static readonly DEFAULT_STDLIB: StdLibSupport = {
    hasVector: true, hasString: true, hasIostream: true,
    hasExceptions: true, hasRTTI: true,
    recommendedArrayImpl: "std_vector", recommendedStringImpl: "std_string",
  };

  // ── Debug code generation ─────────────────────────────────────────────────

  generateDebugInitCode(): string[] {
    return generateSerialInitCode();
  }

  generateDebugBreakpointCode(params: {
    fileName: string; lineNum: number; originalLine: string;
    variables: Array<{ name: string; isFunction?: boolean }>;
    normalizedCondition?: string;
  }): string[] {
    return generateBreakpointCode(
      params.fileName, params.lineNum, params.originalLine,
      params.variables, params.normalizedCondition,
    );
  }

  generateDebugLogpointCode(params: {
    fileName: string; lineNum: number;
    parts: Array<{ type: 'text' | 'variable'; value: string }>;
    variables: Array<{ name: string; isFunction?: boolean }>;
  }): string[] {
    return generateLogpointCode(params.fileName, params.lineNum, params.parts, params.variables);
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers used by ArduinoStrategy
// ---------------------------------------------------------------------------

/**
 * Detect whether the program uses console.* calls.
 */
function detectConsoleUsage(program: ProgramIR): boolean {
  const consolePrefixes = ["console.log", "console.error", "console.warn", "console.info", "console.debug"];
  const checkStmts = (stmts: StatementIR[]): boolean => {
    for (const stmt of stmts) {
      if (stmt.kind === "call" && consolePrefixes.some(p => stmt.callee.startsWith(p))) return true;
      if ("body" in stmt && Array.isArray(stmt.body) && checkStmts(stmt.body)) return true;
      if ("thenBranch" in stmt && Array.isArray(stmt.thenBranch) && checkStmts(stmt.thenBranch)) return true;
      if ("elseBranch" in stmt && Array.isArray(stmt.elseBranch) && checkStmts(stmt.elseBranch)) return true;
      if ("cases" in stmt && Array.isArray((stmt as any).cases)) {
        for (const c of (stmt as any).cases) { if (checkStmts(c.body)) return true; }
      }
      if ("tryBlock" in stmt && Array.isArray(stmt.tryBlock) && checkStmts(stmt.tryBlock)) return true;
      if ("catchBlock" in stmt && Array.isArray(stmt.catchBlock) && checkStmts(stmt.catchBlock)) return true;
    }
    return false;
  };
  for (const fn of program.functions) { if (checkStmts(fn.statements)) return true; }
  if (checkStmts(program.topLevelStatements)) return true;
  for (const cls of program.classes) {
    for (const m of cls.methods) { if (checkStmts(m.statements)) return true; }
    if (cls.constructor && checkStmts(cls.constructor.statements)) return true;
  }
  return false;
}

/**
 * Detect whether the program already calls Serial.begin (or similar .begin()).
 */
function detectSerialBeginCall(program: ProgramIR): boolean {
  const checkStmt = (stmt: StatementIR): boolean => {
    if (stmt.kind === "call" && (stmt.callee === "Serial.begin" || stmt.callee.endsWith(".begin"))) return true;
    if ("body" in stmt && Array.isArray(stmt.body)) { for (const s of stmt.body) { if (checkStmt(s)) return true; } }
    if ("thenBranch" in stmt && Array.isArray(stmt.thenBranch)) { for (const s of stmt.thenBranch) { if (checkStmt(s)) return true; } }
    if ("elseBranch" in stmt && Array.isArray(stmt.elseBranch)) { for (const s of stmt.elseBranch) { if (checkStmt(s)) return true; } }
    if ("cases" in stmt && Array.isArray((stmt as any).cases)) {
      for (const c of (stmt as any).cases) { for (const s of c.body) { if (checkStmt(s)) return true; } }
    }
    if ("tryBlock" in stmt && Array.isArray(stmt.tryBlock)) { for (const s of stmt.tryBlock) { if (checkStmt(s)) return true; } }
    if ("catchBlock" in stmt && Array.isArray(stmt.catchBlock)) { for (const s of stmt.catchBlock) { if (checkStmt(s)) return true; } }
    return false;
  };
  for (const fn of program.functions) { for (const s of fn.statements) { if (checkStmt(s)) return true; } }
  for (const s of program.topLevelStatements) { if (checkStmt(s)) return true; }
  for (const cls of program.classes) {
    for (const m of cls.methods) { for (const s of m.statements) { if (checkStmt(s)) return true; } }
    if (cls.constructor) { for (const s of cls.constructor.statements) { if (checkStmt(s)) return true; } }
  }
  return false;
}

const AVR_PIN_EDGE_BLOCKING_POLYFILL = `namespace typehal_async {
  inline void waitForPinEdge(int pin, int mode) {
    int target = (mode == RISING) ? HIGH : LOW;
    int idle   = (mode == RISING) ? LOW  : HIGH;
    while (digitalRead(pin) != idle) { }
    while (digitalRead(pin) != target) { }
    delay(10);
  }
}`;

/**
 * Scan IR to see if waitForRising or waitForFalling is used.
 */
function detectWaitForPinEdgeUsage(program: ProgramIR): boolean {
  const checkStmt = (stmt: StatementIR): boolean => {
    if (stmt.kind === "typehal-call" && (stmt.method === "waitForRising" || stmt.method === "waitForFalling")) return true;
    if ("body" in stmt && Array.isArray(stmt.body)) { for (const s of stmt.body) { if (checkStmt(s)) return true; } }
    if ("thenBranch" in stmt && Array.isArray(stmt.thenBranch)) { for (const s of stmt.thenBranch) { if (checkStmt(s)) return true; } }
    if ("elseBranch" in stmt && Array.isArray(stmt.elseBranch)) { for (const s of stmt.elseBranch) { if (checkStmt(s)) return true; } }
    if ("cases" in stmt && Array.isArray((stmt as any).cases)) {
      for (const c of (stmt as any).cases) { for (const s of c.body) { if (checkStmt(s)) return true; } }
    }
    if ("tryBlock" in stmt && Array.isArray(stmt.tryBlock)) { for (const s of stmt.tryBlock) { if (checkStmt(s)) return true; } }
    if ("catchBlock" in stmt && Array.isArray(stmt.catchBlock)) { for (const s of stmt.catchBlock) { if (checkStmt(s)) return true; } }
    return false;
  };
  for (const fn of program.functions) { for (const s of fn.statements) { if (checkStmt(s)) return true; } }
  for (const s of program.topLevelStatements) { if (checkStmt(s)) return true; }
  for (const cls of program.classes) {
    for (const m of cls.methods) { for (const s of m.statements) { if (checkStmt(s)) return true; } }
    if (cls.constructor) { for (const s of cls.constructor.statements) { if (checkStmt(s)) return true; } }
  }
  return false;
}

/**
 * Generate the cooperative microtask queue + Promise runtime C++ code.
 */
function generatePromiseRuntime(target: string): string {
  const queueCapacity = target === "arduino" ? 32 : 256;
  return `
// Polyfill: cooperative microtask queue + minimal Promise runtime
namespace typehal_async {
  using Microtask = std::function<void()>;

  class MicrotaskQueue {
  public:
    static MicrotaskQueue& instance() {
      static MicrotaskQueue queue;
      return queue;
    }

    bool enqueue(Microtask task) {
      if (_queue.size() >= ${queueCapacity}) {
        return false;
      }
      _queue.push_back(std::move(task));
      return true;
    }

    void pump() {
      const size_t total = _queue.size();
      for (size_t i = 0; i < total; ++i) {
        Microtask task = std::move(_queue[i]);
        task();
      }
      if (total > 0) {
        _queue.erase(_queue.begin(), _queue.begin() + static_cast<long long>(total));
      }
    }

  private:
    std::vector<Microtask> _queue;
  };

  inline void enqueueMicrotask(Microtask task) {
    MicrotaskQueue::instance().enqueue(std::move(task));
  }

  inline void pumpMicrotasks() {
    MicrotaskQueue::instance().pump();
  }

  template <typename T>
  class Promise {
  public:
    enum class State { Pending, Fulfilled, Rejected };

    Promise() : _state(State::Pending), _value{}, _error{} {}

    explicit Promise(std::function<void(std::function<void(const T&)>, std::function<void(const std::string&)>)> executor)
      : _state(State::Pending), _value{}, _error{} {
      executor(
        [this](const T& value) { this->resolve(value); },
        [this](const std::string& error) { this->reject(error); }
      );
    }

    static Promise<T> resolveValue(const T& value) {
      Promise<T> promise;
      promise.resolve(value);
      return promise;
    }

    static Promise<T> rejectValue(const std::string& error) {
      Promise<T> promise;
      promise.reject(error);
      return promise;
    }

    void resolve(const T& value) {
      if (_state != State::Pending) return;
      _state = State::Fulfilled;
      _value = value;
      auto callbacks = _onFulfilled;
      enqueueMicrotask([callbacks, value]() mutable {
        for (auto& callback : callbacks) { callback(value); }
      });
    }

    void reject(const std::string& error) {
      if (_state != State::Pending) return;
      _state = State::Rejected;
      _error = error;
      auto callbacks = _onRejected;
      enqueueMicrotask([callbacks, error]() mutable {
        for (auto& callback : callbacks) { callback(error); }
      });
    }

    Promise<T>& then(std::function<void(const T&)> onFulfilled) {
      if (_state == State::Fulfilled) {
        const T value = _value;
        enqueueMicrotask([onFulfilled, value]() mutable { onFulfilled(value); });
      } else if (_state == State::Pending) {
        _onFulfilled.push_back(std::move(onFulfilled));
      }
      return *this;
    }

    Promise<T>& catchError(std::function<void(const std::string&)> onRejected) {
      if (_state == State::Rejected) {
        const std::string error = _error;
        enqueueMicrotask([onRejected, error]() mutable { onRejected(error); });
      } else if (_state == State::Pending) {
        _onRejected.push_back(std::move(onRejected));
      }
      return *this;
    }

  private:
    State _state;
    T _value;
    std::string _error;
    std::vector<std::function<void(const T&)>> _onFulfilled;
    std::vector<std::function<void(const std::string&)>> _onRejected;
  };

  /**
   * wait for a pin edge (RISING/FALLING). 
   * Implementation uses a simple polling mechanism for now to keep it generic,
   * or it could use attachInterrupt if we had a global interrupt manager.
   */
  inline Promise<void> waitForPinEdge(int pin, int mode) {
    return Promise<void>([pin, mode](std::function<void(const void*)> resolve, std::function<void(const std::string&)> reject) {
       // This is a stub. Real implementation would use interrupts.
       // For now we just resolve immediately so it doesn't hang forever during testing.
       resolve(nullptr); 
    });
  }
}

inline void typehal_pump_microtasks() {
  typehal_async::pumpMicrotasks();
}
`;
}

/**
 * Scan IR to see if createPinGroup is called.
 */
function detectPinGroupUsage(program: ProgramIR): boolean {
  const checkStmt = (stmt: StatementIR): boolean => {
    if (stmt.kind === "call" && stmt.callee === "createPinGroup") return true;
    if ("body" in stmt && Array.isArray(stmt.body)) { for (const s of stmt.body) { if (checkStmt(s)) return true; } }
    if ("thenBranch" in stmt && Array.isArray(stmt.thenBranch)) { for (const s of stmt.thenBranch) { if (checkStmt(s)) return true; } }
    if ("elseBranch" in stmt && Array.isArray(stmt.elseBranch)) { for (const s of stmt.elseBranch) { if (checkStmt(s)) return true; } }
    if ("cases" in stmt && Array.isArray((stmt as any).cases)) {
      for (const c of (stmt as any).cases) { for (const s of c.body) { if (checkStmt(s)) return true; } }
    }
    if ("tryBlock" in stmt && Array.isArray(stmt.tryBlock)) { for (const s of stmt.tryBlock) { if (checkStmt(s)) return true; } }
    if ("catchBlock" in stmt && Array.isArray(stmt.catchBlock)) { for (const s of stmt.catchBlock) { if (checkStmt(s)) return true; } }
    return false;
  };
  for (const fn of program.functions) { for (const s of fn.statements) { if (checkStmt(s)) return true; } }
  for (const s of program.topLevelStatements) { if (checkStmt(s)) return true; }
  for (const cls of program.classes) {
    for (const m of cls.methods) { for (const s of m.statements) { if (checkStmt(s)) return true; } }
    if (cls.constructor) { for (const s of cls.constructor.statements) { if (checkStmt(s)) return true; } }
  }
  return false;
}