// ---------------------------------------------------------------------------
// ArduinoStrategy — Arduino framework target (setup/loop, Serial, .ino …)
//
// Absorbs all Arduino-specific emit logic previously scattered across
// cpp-emitter.ts, typecode-map.ts, and arduino-profile.ts.
// ---------------------------------------------------------------------------

import type { PlatformStrategy } from "typecode/platform";
import type { ExpressionIR, ProgramIR } from "typecode/ir";
import type { Diagnostic, PlatformContext } from "typecode/types";
import type { BoardConstants } from "typecode/board-resolver";
import type { TypecodeReceiverKind } from "typecode/typecode-symbols";
import type { RuntimePolyfillIR } from "typecode/polyfill/types";
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

  /**
   * Allows the emitter to inform this strategy which enums have large values
   * so that static_cast uses `long` instead of `int`.
   */
  setLargeEnumNames(names: ReadonlySet<string>): void {
    _largeEnumNames = names;
  }

  // ── Profile ─────────────────────────────────────────────────────────────

  forcedIncludes(program: ProgramIR, ctx?: PlatformContext): string[] {
    return resolveArduinoProfile(program, ctx).forcedIncludes;
  }
  symbolAliases(program: ProgramIR, ctx?: PlatformContext): Record<string, string> {
    return resolveArduinoProfile(program, ctx).symbolAliases;
  }
  shimLines(program: ProgramIR, ctx?: PlatformContext): string[] {
    return resolveArduinoProfile(program, ctx).shimLines;
  }
  profileDiagnostics(program: ProgramIR, ctx?: PlatformContext): Diagnostic[] {
    return resolveArduinoProfile(program, ctx).diagnostics;
  }

  // ── Polyfill overrides ──────────────────────────────────────────────────

  /**
   * Default implementation returns empty set.
   * Board packages can override to provide native implementations.
   */
  nativePolyfills(): Set<string> {
    return new Set();
  }

  /**
   * Default implementation returns empty array.
   * Board packages can override to provide native polyfill implementations.
   */
  generateNativePolyfills(_program: ProgramIR, _ctx?: PlatformContext): RuntimePolyfillIR[] {
    return [];
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
    return (isEntryFile && !isNpmPackage) ? "ino" : "cpp";
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

  normalizeCppType(typeName: string): string {
    if (typeName === "auto") return "int";
    if (typeName === "std::string") return "const char*";
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
    v = v.replace(/\bundefined\b/g, "0");
    v = v.replace(/\bnull\b/g, "0");
    return v;
  }
  nullValue(): string {
    return "0";
  }
  wrapStringConcat(leftRendered: string, rightRendered: string, leftIsString: boolean): string | undefined {
    if (leftIsString) {
      return `String(${leftRendered}) + ${rightRendered}`;
    }
    return undefined;
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
    
    // For namespace calls (Pulse, Shift, Random, Num), try the statement-level handler
    // These need to work in expression context too (e.g., const d = Pulse.in(D2, HIGH))
    if (receiverKind === 'pulse' || receiverKind === 'shift' || receiverKind === 'random' || receiverKind === 'num') {
      const callee = `${receiver}.${method}`;
      return tryRenderTypecodeCallStatement(callee, args, "arduino", renderArg, boardConstants) ?? undefined;
    }
    
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
    return "for (;;) {}";
  }
  transformConsoleCall(method: string, renderedArgs: string, forHeader: boolean): string {
    const semi = forHeader ? "" : ";";
    switch (method) {
      case "log":
        return `Serial.println(${renderedArgs})${semi}`;
      case "error":
        return `Serial.print("[ERROR] "); Serial.println(${renderedArgs})${semi}`;
      case "warn":
        return `Serial.print("[WARN] "); Serial.println(${renderedArgs})${semi}`;
      case "info":
        return `Serial.print("[INFO] "); Serial.println(${renderedArgs})${semi}`;
      case "debug":
        return `Serial.print("[DEBUG] "); Serial.println(${renderedArgs})${semi}`;
      default:
        return `Serial.println(${renderedArgs})${semi}`;
    }
  }
  objectFieldInitializer(fieldValue: ExpressionIR, _renderExpr: (e: ExpressionIR) => string): string | undefined {
    // Nested objects are zero-initialized on Arduino (no nested struct init support)
    if (fieldValue.kind === "object") return "0";
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
    if (fieldValue.kind === "object") return "0";
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

  // ── Type aliases ────────────────────────────────────────────────────────

  shouldSkipTypeAlias(cppType: string): boolean {
    return cppType.includes("std::string");
  }

  // ── Diagnostics ─────────────────────────────────────────────────────────

  emitDiagnostics(_emitMode: string): Diagnostic[] {
    // Split mode info message removed - Arduino inherently uses .ino format
    return [];
  }
}