"use strict";
// ---------------------------------------------------------------------------
// ArduinoStrategy — Arduino framework target (setup/loop, Serial, .ino …)
//
// Absorbs all Arduino-specific emit logic previously scattered across
// cpp-emitter.ts, typecode-map.ts, and arduino-profile.ts.
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArduinoStrategy = void 0;
const arduino_profile_1 = require("./arduino-profile");
const typecode_map_1 = require("../emit/typecode-map");
// ---------------------------------------------------------------------------
// Constant sets – previously module-level in cpp-emitter.ts
// ---------------------------------------------------------------------------
/**
 * Names predefined by the Arduino / ESP32 framework as macros or globals.
 * Emitting C++ declarations with these names causes redeclaration errors.
 */
const ARDUINO_RESERVED_NAMES = new Set([
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
const ARDUINO_ENUM_MEMBER_RENAMES = new Set([
    "HIGH", "LOW", "INPUT", "OUTPUT", "INPUT_PULLUP",
    "RISING", "FALLING", "CHANGE",
    "INPUT_PULLDOWN", "OUTPUT_OPEN_DRAIN", "ANALOG",
    "DEFAULT", "INTERNAL", "EXTERNAL",
    "RTC",
]);
/**
 * Enum class names already declared as C typedefs in the new Arduino API.
 */
const ARDUINO_API_RESERVED_ENUMS = new Set([
    "PinMode", "InterruptMode",
]);
// Shared set of large enum names (values > 16-bit signed int range)
// populated externally via setLargeEnumNames().
let _largeEnumNames = new Set();
class ArduinoStrategy {
    constructor() {
        this.id = "arduino";
    }
    /**
     * Allows the emitter to inform this strategy which enums have large values
     * so that static_cast uses `long` instead of `int`.
     */
    setLargeEnumNames(names) {
        _largeEnumNames = names;
    }
    // ── Profile ─────────────────────────────────────────────────────────────
    forcedIncludes(program, ctx) {
        return (0, arduino_profile_1.resolveArduinoProfile)(program, ctx).forcedIncludes;
    }
    symbolAliases(program, ctx) {
        return (0, arduino_profile_1.resolveArduinoProfile)(program, ctx).symbolAliases;
    }
    shimLines(program, ctx) {
        return (0, arduino_profile_1.resolveArduinoProfile)(program, ctx).shimLines;
    }
    profileDiagnostics(program, ctx) {
        return (0, arduino_profile_1.resolveArduinoProfile)(program, ctx).diagnostics;
    }
    // ── File shape ──────────────────────────────────────────────────────────
    sourceExtension(isEntryFile, isNpmPackage) {
        return (isEntryFile && !isNpmPackage) ? "ino" : "cpp";
    }
    entrypointFunctionName() {
        return "setup";
    }
    requiresLoopFunction() {
        return true;
    }
    overrideBaseName(originalBaseName, outDirBaseName, isEntryFile, isNpmPackage) {
        // Arduino .ino files must match the containing directory name
        return (!isNpmPackage && isEntryFile) ? outDirBaseName : originalBaseName;
    }
    effectiveEmitMode(_requestedMode, isNpmPackage) {
        return isNpmPackage ? _requestedMode : "cpp";
    }
    // ── Type normalisation ──────────────────────────────────────────────────
    normalizeCppType(typeName) {
        if (typeName === "auto")
            return "int";
        if (typeName === "std::string")
            return "const char*";
        const fnTypeMatch = typeName.match(/^std::function<\s*([^()<>]+)\((.*)\)\s*>$/);
        if (fnTypeMatch) {
            const returnType = fnTypeMatch[1].trim();
            const params = fnTypeMatch[2].trim();
            return `${returnType} (*)(${params})`;
        }
        return typeName;
    }
    mapReturnType(functionName, returnType) {
        if (functionName === "setup" || functionName === "loop")
            return "void";
        return this.normalizeCppType(returnType);
    }
    mapFunctionName(originalName) {
        if (originalName === "void" || originalName === "__arduino_setup__")
            return "setup";
        return originalName;
    }
    // ── Expression rendering ────────────────────────────────────────────────
    normalizeRawExpression(value) {
        let v = value;
        v = v.replace(/\bPinMode::(HIGH|LOW|INPUT|OUTPUT|INPUT_PULLUP)\b/g, "PinMode::_$1");
        v = v.replace(/\bPinMode::(_?[A-Z_]+)\b/g, "static_cast<int>(PinMode::$1)");
        v = v.replace(/(->|\.)capabilities\.interrupt\b/g, "$1capabilities");
        v = v.replace(/\bstd::(floor|ceil|round|trunc|sqrt|pow|sin|cos|tan|asin|acos|atan|abs|max|min)\b/g, "$1");
        v = v.replace(/\bDate\.now\(\)/g, "millis()");
        v = v.replace(/\bundefined\b/g, "0");
        v = v.replace(/\bnull\b/g, "0");
        return v;
    }
    nullValue() {
        return "0";
    }
    wrapStringConcat(leftRendered, rightRendered, leftIsString) {
        if (leftIsString) {
            return `String(${leftRendered}) + ${rightRendered}`;
        }
        return undefined;
    }
    renameEnumMember(_enumName, memberName) {
        return ARDUINO_ENUM_MEMBER_RENAMES.has(memberName) ? `_${memberName}` : memberName;
    }
    enumCastType(enumName) {
        return _largeEnumNames.has(enumName) ? "long" : "int";
    }
    tryRenderTypecodeCall(receiver, receiverKind, method, args, renderArg, boardConstants) {
        return (0, typecode_map_1.renderArduinoBuiltin)(receiver, receiverKind, method, args, renderArg, boardConstants);
    }
    renderBoardDefinitionAccess(chain, boardConstants) {
        if (chain.length < 3)
            return undefined;
        if (chain[0] !== "Board" && chain[0] !== "Pins")
            return undefined;
        if (chain[1] !== "definition")
            return undefined;
        if (!boardConstants)
            return undefined;
        const dotPath = chain.slice(2).join(".");
        const value = boardConstants.get(dotPath);
        if (value === undefined)
            return undefined;
        return typeof value === "string" ? `"${value}"` : `${value}`;
    }
    // ── Statement rendering ─────────────────────────────────────────────────
    tryRenderCallStatement(callee, args, renderArg, boardConstants) {
        return (0, typecode_map_1.tryRenderTypecodeCallStatement)(callee, args, "arduino", renderArg, boardConstants) ?? undefined;
    }
    renderThrow(_valueExpr) {
        return "for (;;) {}";
    }
    transformConsoleCall(method, renderedArgs, forHeader) {
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
    objectFieldInitializer(fieldValue, _renderExpr) {
        // Nested objects are zero-initialized on Arduino (no nested struct init support)
        if (fieldValue.kind === "object")
            return "0";
        return undefined;
    }
    overrideClassFieldType(fieldName, normalizedType) {
        // _interruptHandler is a function pointer on Arduino
        if (fieldName === "_interruptHandler" && normalizedType === "int") {
            return "void (*)(void)";
        }
        return normalizedType;
    }
    // ── Name guards ─────────────────────────────────────────────────────────
    reservedNames() {
        return ARDUINO_RESERVED_NAMES;
    }
    apiReservedEnumNames() {
        return ARDUINO_API_RESERVED_ENUMS;
    }
    apiReservedEnumGuard() {
        return "ARDUINO_API_VERSION";
    }
    // ── Includes ────────────────────────────────────────────────────────────
    needsIostream() { return false; }
    needsStdString() { return false; }
    needsStdVector() { return false; }
    needsStdExcept() { return false; }
    mathHeader() { return "<math.h>"; }
    needsVectorOverload() { return false; }
    // ── Enum underlying type ────────────────────────────────────────────────
    needsLargeEnumUnderlying() { return true; }
    // ── Struct field handling ───────────────────────────────────────────────
    renameStructField(fieldName) {
        return ARDUINO_RESERVED_NAMES.has(fieldName) ? `_${fieldName}` : fieldName;
    }
    structFieldInitializer(fieldValue, compiletimeVarNames, _renderExpr) {
        if (fieldValue.kind === "object")
            return "0";
        if (fieldValue.kind === "identifier") {
            const identName = fieldValue.value;
            if (!compiletimeVarNames.has(identName))
                return "0";
        }
        return undefined;
    }
    // ── Async ───────────────────────────────────────────────────────────────
    asyncLoopInjection(taskVarNames, hasPromiseRuntime) {
        const lines = [];
        for (const n of taskVarNames) {
            lines.push(`  ${n}.run();`);
        }
        if (hasPromiseRuntime)
            lines.push("  ts2cpp_pump_microtasks();");
        return lines;
    }
    asyncDriverFunctionName() { return "loop"; }
    // ── Type aliases ────────────────────────────────────────────────────────
    shouldSkipTypeAlias(cppType) {
        return cppType.includes("std::string");
    }
    // ── Diagnostics ─────────────────────────────────────────────────────────
    emitDiagnostics(emitMode) {
        if (emitMode === "split") {
            return [{
                    severity: "info",
                    code: "TS2CPP_ARDUINO_SPLIT_IGNORED",
                    message: "Arduino target emits a single .ino sketch file; split header/source mode was ignored.",
                }];
        }
        return [];
    }
}
exports.ArduinoStrategy = ArduinoStrategy;
//# sourceMappingURL=arduino-strategy.js.map