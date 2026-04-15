import path from "node:path";
import fs from "node:fs";
import { ProgramIR, ExpressionIR, StatementIR, VariableDeclarationIR, AssignmentIR } from "../ir/model";
import { analyzeProgram, ProgramAnalysisResult } from "../ir/program-analysis";
import { Diagnostic, EmitMode, GeneratedOutputs, PlatformContext, SourceMapEntry, TargetProfile } from "../types";
import { ensureDir, writeText } from "../utils/fs";
import { resolveImport } from "../libdef/registry";
import { LibraryDefinition } from "../types";
import { makeGeneratedMap, writeSourceMap } from "../mapping/source-map";
import { RuntimePolyfillIR } from "../polyfill/types";
import { emitPolyfillBoilerplate } from "../polyfill/emitter";
import { ResolvedNpmPackage } from "../transpile";
import { extractPropertyChain } from "../platform/typecode-map";
import type { BoardConstants } from "../ir/board-resolver";
import type { PlatformStrategy } from "../platform/platform-strategy";
import { resolveStrategy } from "../platform/registry";
import { ArduinoStrategy } from "../platform/arduino-strategy";
import { buildArduinoClassNameMap } from "./arduino-class-map";
import { buildSnprintfRenderResult, cloneEmissionScopeState, createChildEmissionScope, createEmissionScopeState, type EmissionScopeState, inferSnprintfArg, recordVariableType, statementNeedsSnprintf, shouldUseSnprintfForArduinoString } from "./arduino-snprintf";
import { normalizeRawExpression, transformTypeName } from "./expression-renderer";
import { StatementRenderer } from "./statement-renderer";

// ---------------------------------------------------------------------------
// Pre-compiled regex patterns for performance
// ---------------------------------------------------------------------------
const PATH_BACKSLASH_PATTERN = /\\/g;
const DOUBLE_QUOTE_PATTERN = /"/g;
const DOUBLE_QUOTE_ESCAPE_PATTERN = /"/g;
const JS_EXTENSION_PATTERN = /\.js$/;
const MJS_EXTENSION_PATTERN = /\.mjs$/;
const FILE_EXTENSION_PATTERN = /\.[^.]+$/;
const I2C_PERIPHERAL_PATTERN = /^I2C\d+$/;
const SPI_PERIPHERAL_PATTERN = /^SPI\d+$/;
const UART_PERIPHERAL_PATTERN = /^UART\d+$/;

// ---------------------------------------------------------------------------
// Emit-time context
// ---------------------------------------------------------------------------
// DEPRECATED: Module-level mutable state.
//
// This pattern makes dependencies implicit and complicates testing.
// New code should use StatementRenderer/ExpressionRenderer classes from
// ./statement-renderer.ts and ./expression-renderer.ts which accept
// context via constructor injection.
//
// See CLAUDE.md and ARCHITECTURE.md for the refactoring roadmap.
//
// Set at the start of each emitCpp call and consulted by renderExpression.
// Using a module-level variable avoids threading boardConstants through the
// entire renderStatement / renderExpression call chain.
let _emitBoardConstants: BoardConstants | undefined;

// Arduino library class name mapping (simple name -> fully qualified name with namespace)
// Used to transform "new SHT3x()" to "new Microfire::SHT3x()" etc.
let _arduinoClassNameMap: Map<string, string> | undefined;

// DEPRECATED: Module-level mutable state (same as _emitBoardConstants above).
//
// Accumulates enum class names across all files compiled in one transpilation
// run so that renderExpression can use `::` instead of `.` for enum member
// access (e.g. I2CSpeed.STANDARD → I2CSpeed::STANDARD) even when the enum
// type is defined in a different source file (imported from @typecode/core).
const _emitEnumNames: Set<string> = new Set();

// DEPRECATED: Module-level mutable state (same as _emitBoardConstants above).
//
// Enum names whose members have values outside the 16-bit signed int range
// (i.e. > 32767 or < -32768).  On AVR, `int` is 16-bit, so these enums need
// an explicit `long` underlying type and their static_cast must use `long`.
const _largeEnumNames: Set<string> = new Set();

/**
 * Pre-populate the module-level enum registries from *all* program IRs before
 * any `emitCpp` call. Call this once in `transpile.ts` after building +
 * tree-shaking every file so that property-access rendering and struct field
 * type inference work correctly regardless of processing order.
 */
export function registerAllEnumNames(
  enums: Iterable<{ name: string; members: { name: string; value?: number }[] }>
): void {
  for (const e of enums) {
    _emitEnumNames.add(e.name);
    if (e.members.some(m => m.value !== undefined && (m.value > 32767 || m.value < -32768))) {
      _largeEnumNames.add(e.name);
    }
  }
}

// NOTE: arduinoEnumMemberRenames has been moved into ArduinoStrategy.
// The strategy's renameEnumMember() method handles this per-platform.

// Default strategy used when none is explicitly provided to helper functions.
// Overridden at the top of each emitCpp() call.
let _defaultStrategy: PlatformStrategy = resolveStrategy("generic");

/**
 * Checks if a module specifier resolves to a typecode SDK path.
 * Typecode SDK files (code/core/*, code/board-*, @typecode/* packages) are 
 * type-level only and should produce no C++ output or #include directives.
 */
function isTypecodeSDKImport(moduleSpecifier: string, fromFile: string): boolean {
  // Check for @typecode/* npm package imports
  if (moduleSpecifier.startsWith("@typecode/")) {
    return true;
  }

  // Check for bare "@typecode" virtual import (resolved via typecode.config.ts)
  if (moduleSpecifier === "@typecode") {
    return true;
  }
  
  // Check for relative imports to code/core or code/board-* paths
  if (!moduleSpecifier.startsWith(".")) {
    return false;
  }
  const basePath = path.resolve(path.dirname(fromFile), moduleSpecifier);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const normalized = candidate.replace(/\\/g, "/");
      if (/\/code\/core\//.test(normalized) || /\/code\/board-/.test(normalized)) {
        return true;
      }
    }
  }
  return false;
}

interface EmitterOptions {
  outDir: string;
  emitMode: EmitMode;
  target: TargetProfile;
  libdefs: Map<string, LibraryDefinition>;
  emitMaps: boolean;
  platformContext?: PlatformContext;
  polyfills?: RuntimePolyfillIR[];
  /** Info about the npm package being transpiled (if this file is from an npm package) */
  npmPackage?: ResolvedNpmPackage;
  /** Map of all npm packages being transpiled (source path -> package info) */
  npmPackages?: Map<string, ResolvedNpmPackage>;
  /** Whether this is the entry file (main .ino for Arduino) */
  isEntryFile?: boolean;
  /** Override the platform strategy (resolved from target if not provided). */
  strategy?: PlatformStrategy;
  /** Native C++ modules detected during import resolution (module specifier -> info) */
  nativeModules?: Map<string, { declPath: string; cppPath: string; moduleKey: string }>;
  /**
   * Class names defined in other transpiled modules.
   * Used to emit forward declarations in the header so that cross-module
   * type references compile correctly (especially for pointer/reference types).
   */
  crossModuleClasses?: Set<string>;
}



// Module-level state for snprintf prelude accumulation during statement rendering.
// Set by appendRenderedStatement() before calling renderStatement() for the generic
// fallback path, and consumed by renderExpression() when encountering string_concat
// or template_string expressions.
let _pendingSnprintfLines: string[] = [];
let _currentScopeState: EmissionScopeState | undefined;
let _currentPointerVarTypes: Map<string, string> | undefined;
let _currentKnownFunctionReturnTypes: Map<string, string> | undefined;

/**
 * Render peripheral stub property access to appropriate C++ values.
 * TypeScript peripheral stubs (I2C0, SPI0, UART0) have properties like isInitialized,
 * busNumber, speed that don't exist in C++. We map them to appropriate values.
 * 
 * @param chain Property access chain (e.g., ["I2C0", "isInitialized"])
 * @returns C++ value string or undefined if not a peripheral property
 */
function renderPeripheralProperty(chain: string[]): string | undefined {
  // Must have exactly 2 parts: peripheral name and property
  if (chain.length !== 2) return undefined;
  
  const [peripheral, property] = chain;
  
  // Resolve peripheral name to C++ equivalent
  let cppPeripheral: string | undefined;
  
  // I2C buses: I2C0 -> Wire, I2C1 -> Wire1, I2C2 -> Wire2
  if (/^I2C\d+$/.test(peripheral)) {
    const num = peripheral.slice(3);
    cppPeripheral = num === '0' ? 'Wire' : `Wire${num}`;
  }
  // SPI buses: SPI0 -> SPI, SPI1 -> SPI1, SPI2 -> SPI2
  else if (/^SPI\d+$/.test(peripheral)) {
    const num = peripheral.slice(3);
    cppPeripheral = num === '0' ? 'SPI' : `SPI${num}`;
  }
  // UART ports: UART0 -> Serial, UART1 -> Serial1, UART2 -> Serial2
  else if (/^UART\d+$/.test(peripheral)) {
    const num = peripheral.slice(4);
    cppPeripheral = num === '0' ? 'Serial' : `Serial${num}`;
  }
  // Serial ports: Serial -> Serial, Serial1 -> Serial1, Serial2 -> Serial2
  else if (/^Serial\d*$/.test(peripheral)) {
    cppPeripheral = peripheral;
  }
  
  // Check if this is a known peripheral
  if (!cppPeripheral) return undefined;
  
  // Properties that exist on the C++ objects
  // For these, we can access them directly
  const directProperties = new Set(["available"]);
  
  // Properties that are compile-time stubs in TypeScript but don't exist in C++
  // These should return true (since the peripheral is initialized in setup())
  const stubProperties = new Set([
    "isInitialized", 
    "isConnected",
  ]);
  
  // Properties that are numeric constants in TypeScript
  const numericProperties = new Set([
    "busNumber", 
    "uartNumber",
  ]);
  
  if (directProperties.has(property)) {
    // These exist on the C++ object
    return `${cppPeripheral}.${property}`;
  }
  
  if (stubProperties.has(property)) {
    // These are runtime state - return true since we initialize in setup()
    // A more sophisticated solution would track initialization state
    return "true";
  }
  
  if (numericProperties.has(property)) {
    // busNumber is always 0 for the main peripheral
    if (property === "busNumber" || property === "uartNumber") {
      return "0";
    }
  }
  
  // For speed, we could return Wire.getClock() or similar, but it's runtime
  // For now, return a default standard speed
  if (property === "speed") {
    return "100000"; // 100kHz standard speed
  }
  
  return undefined;
}

function normalizeComment(comment: string): string[] {
  return comment
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

function emitCommentLines(
  comments: string[] | undefined,
  indent: string,
  appendLine: (line: string) => void,
): void {
  for (const comment of comments ?? []) {
    for (const line of normalizeComment(comment)) {
      appendLine(`${indent}${line}`);
    }
  }
}

function renderExpression(expr: ExpressionIR, exprTransformer?: (expr: string) => string, strategy: PlatformStrategy = _defaultStrategy, classNameMap?: Map<string, string>): string {
  // Safety check
  if (!expr || typeof expr !== 'object' || !expr.kind) {
    return "/* invalid expression */";
  }
  
  switch (expr.kind) {
    case "number":
      return `${expr.value}`;
    case "string":
      DOUBLE_QUOTE_PATTERN.lastIndex = 0;
      return `"${expr.value.replace(DOUBLE_QUOTE_PATTERN, '\\"')}"`;
    case "boolean":
      return expr.value ? "true" : "false";
    case "identifier": {
      const nullVal = strategy.nullValue();
      if (nullVal && (expr.value === "null" || expr.value === "undefined")) {
        return nullVal;
      }
      // Map peripheral identifiers to Arduino equivalents
      // I2C0 -> Wire, I2C1 -> Wire1, SPI0 -> SPI, UART0 -> Serial
      const peripheralName = expr.value;
      if (I2C_PERIPHERAL_PATTERN.test(peripheralName)) {
        const num = peripheralName.slice(3);
        return num === '0' ? 'Wire' : `Wire${num}`;
      }
      if (SPI_PERIPHERAL_PATTERN.test(peripheralName)) {
        const num = peripheralName.slice(3);
        return num === '0' ? 'SPI' : `SPI${num}`;
      }
      if (UART_PERIPHERAL_PATTERN.test(peripheralName)) {
        const num = peripheralName.slice(4);
        return num === '0' ? 'Serial' : `Serial${num}`;
      }
      return expr.value;
    }
    case "raw":
      // Apply transformation to raw expressions (for fixing pointer field access)
      // Use module-level _arduinoClassNameMap if no classNameMap provided
      const effectiveClassNameMap = classNameMap ?? _arduinoClassNameMap;
      if (exprTransformer) {
        return normalizeRawExpression(exprTransformer(expr.value), strategy, effectiveClassNameMap);
      }
      return normalizeRawExpression(expr.value, strategy, effectiveClassNameMap);
    case "await":
      return renderExpression(expr.value, exprTransformer, strategy);
    case "ternary":
      return `(${renderExpression(expr.condition, exprTransformer, strategy)} ? ${renderExpression(expr.whenTrue, exprTransformer, strategy)} : ${renderExpression(expr.whenFalse, exprTransformer, strategy)})`;

    case "string_concat": {
      // When snprintf mode is active and we're in a statement rendering context,
      // build snprintf buffer instead of String() concatenation
      if (strategy.useSnprintfForStrings() && _currentScopeState) {
        const snprintfRender = buildSnprintfRenderResult(
          expr,
          strategy,
          _currentScopeState,
          (expression) => renderExpression(expression, undefined, strategy),
          _currentPointerVarTypes,
          _currentKnownFunctionReturnTypes,
        );
        if (snprintfRender) {
          const bufferName = `__typecode_str_${++_currentScopeState.nextSnprintfTempId}`;
          _pendingSnprintfLines.push(
            ...snprintfRender.preludeLines,
            `char ${bufferName}[${snprintfRender.estimatedLength}];`,
            `snprintf(${bufferName}, sizeof(${bufferName}), "${snprintfRender.formatString}"${snprintfRender.args.length > 0 ? `, ${snprintfRender.args.join(", ")}` : ""});`,
          );
          return bufferName;
        }
      }
      // Fallback: Build a String concatenation chain
      const renderedParts = expr.parts.map(part => {
        const rendered = renderExpression(part, exprTransformer, strategy);
        // Wrap non-string expressions in String() constructor for concatenation
        if (part.kind === "string") {
          return rendered;
        }
        // For template_string, wrap in String() to convert to string
        if (part.kind === "template_string") {
          return `String(${rendered})`;
        }
        // For other types, also wrap in String()
        return `String(${rendered})`;
      });
      return renderedParts.join(" + ");
    }

    case "template_string": {
      // When snprintf mode is active and we're in a statement rendering context,
      // build snprintf buffer for single interpolation
      if (strategy.useSnprintfForStrings() && _currentScopeState) {
        const arg = inferSnprintfArg(
          expr.expression,
          strategy,
          _currentScopeState,
          (expression) => renderExpression(expression, undefined, strategy),
          _currentPointerVarTypes,
          _currentKnownFunctionReturnTypes,
        );
        if (arg) {
          const bufferName = `__typecode_str_${++_currentScopeState.nextSnprintfTempId}`;
          const estimatedLength = Math.max(arg.estimatedLength + 1, 16);
          _pendingSnprintfLines.push(
            ...arg.preludeLines,
            `char ${bufferName}[${estimatedLength}];`,
            `snprintf(${bufferName}, sizeof(${bufferName}), "${arg.format}", ${arg.arg});`,
          );
          return bufferName;
        }
      }
      // Fallback: Wrap the expression in String() to convert to string
      return `String(${renderExpression(expr.expression, exprTransformer, strategy)})`;
    }
    case "array":
      const elements = expr.elements.map((e) => renderExpression(e, exprTransformer, strategy)).join(", ");
      return `{ ${elements} }`;
    case "object":
      const fields = expr.fields.map((f) => `${renderExpression(f.value, exprTransformer, strategy)}`).join(", ");
      return `{ ${fields} }`;
    case "instanceof":
      return `(dynamic_cast<const ${expr.className}*>(${renderExpression(expr.object, exprTransformer, strategy)}) != nullptr)`;
    case "spread_array":
      return `/* spread_array: see variable declaration */`;
    case "binary": {
      const leftRendered = renderExpression(expr.left, exprTransformer, strategy);
      const rightRendered = renderExpression(expr.right, exprTransformer, strategy);
      // Platform-specific string concat wrapping (Arduino: String())
      if (expr.operator === "+") {
        const wrapped = strategy.wrapStringConcat(leftRendered, rightRendered, expr.left.kind === "string");
        if (wrapped !== undefined) return wrapped;
      }
      return `${leftRendered} ${expr.operator} ${rightRendered}`;
    }
    case "unary":
      return `${expr.operator}${renderExpression(expr.operand, exprTransformer, strategy)}`;
    case "property-access": {
      const chain = extractPropertyChain(expr);
      if (chain) {
        // Check for Board.definition.* access first
        const boardDef = strategy.renderBoardDefinitionAccess(chain, _emitBoardConstants);
        if (boardDef !== undefined) return boardDef;
        
        // Check for peripheral stub property access (I2C0.isInitialized, SPI0.isInitialized, Serial.isInitialized)
        // These are TypeScript stubs that don't exist in C++ - return appropriate values
        const peripheralProperty = renderPeripheralProperty(chain);
        if (peripheralProperty !== undefined) return peripheralProperty;
      }
      const objStr = renderExpression(expr.object, exprTransformer, strategy);
      // Use C++ scope-resolution operator (::) for enum class member access.
      if (expr.object.kind === "identifier" && _emitEnumNames.has(expr.object.value)) {
        const enumMember = strategy.renameEnumMember(expr.object.value, expr.property);
        const enumAccess = `${objStr}::${enumMember}`;
        const castType = strategy.enumCastType(expr.object.value);
        if (castType !== undefined) {
          return `static_cast<${castType}>(${enumAccess})`;
        }
        return enumAccess;
      }
      return `${objStr}.${expr.property}`;
    }
    case "typecode-call": {
      const renderA = (e: ExpressionIR) => renderExpression(e, exprTransformer, strategy);
      const translated = strategy.tryRenderTypecodeCall(expr.receiver, expr.receiverKind, expr.method, expr.args, renderA, _emitBoardConstants, expr.interruptMode);
      if (translated !== undefined) return translated;
      // Fallback: render as plain method call
      return `${expr.receiver}.${expr.method}(${expr.args.map(renderA).join(", ")})`;
    }
    case "callback": {
      // Callbacks are rendered by the statement emitter which tracks them globally
      // Here we just return a marker that gets replaced with the actual function name
      return `/* callback:${expr.sourceSpan.startLine}:${expr.sourceSpan.startColumn} */`;
    }
    default:
      return "/* unsupported_expr */";
  }
}

// ---------------------------------------------------------------------------
// Strategy-aware helpers (delegate to the active strategy)
// ---------------------------------------------------------------------------

function mapFunctionName(originalName: string, strategy: PlatformStrategy): string {
  return strategy.mapFunctionName(originalName);
}

function normalizeCppTypeForTarget(typeName: string, strategy: PlatformStrategy): string {
  return strategy.normalizeCppType(typeName);
}

function isPrimitiveCppType(cppType: string): boolean {
  const t = cppType.trim();
  const primitives = new Set([
    'int', 'float', 'double', 'bool', 'char', 'long', 'void',
    'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
    'int8_t', 'int16_t', 'int32_t', 'int64_t',
    'size_t', 'byte', 'word',
    'unsigned int', 'unsigned long', 'unsigned char',
    'signed int', 'signed long', 'signed char',
  ]);
  return primitives.has(t);
}

function renderTypedName(cppType: string, name: string, strategy: PlatformStrategy, isConst = false, isRef = false): string {
  const normalizedType = normalizeCppTypeForTarget(cppType, strategy);
  const fnPtrMatch = normalizedType.match(/^(.+?)\s*\(\*\)\((.*)\)$/);
  if (fnPtrMatch) {
    const returnType = fnPtrMatch[1].trim();
    const params = fnPtrMatch[2].trim();
    const constPrefix = isConst ? "const " : "";
    return `${constPrefix}${returnType} (*${name})(${params})`;
  }
  const constPrefix = isConst ? "const " : "";
  const refMark = isRef ? "& " : " ";
  return `${constPrefix}${normalizedType}${refMark}${name}`;
}

function mapReturnType(functionName: string, returnType: string, strategy: PlatformStrategy): string {
  return strategy.mapReturnType(functionName, returnType);
}

function collectDeclaredTypes(program: ProgramIR): string[] {
  const types: string[] = [];

  for (const typeAlias of program.typeAliases) {
    types.push(typeAlias.cppType);
  }

  for (const fn of program.functions) {
    types.push(fn.returnType);
    for (const parameter of fn.parameters) {
      types.push(parameter.cppType);
    }
  }

  for (const statement of program.topLevelStatements) {
    if (statement.kind === "var_decl") {
      types.push(statement.cppType);
    }
  }

  for (const classDef of program.classes) {
    for (const field of classDef.fields) {
      types.push(field.cppType);
    }
    for (const method of classDef.methods) {
      types.push(method.returnType);
      for (const parameter of method.parameters) {
        types.push(parameter.cppType);
      }
    }
    if (classDef.constructor) {
      for (const parameter of classDef.constructor.parameters) {
        types.push(parameter.cppType);
      }
    }
  }

  return types;
}

function inferObjectFieldType(
  value: ExpressionIR,
  pointerVarTypes?: Map<string, string>,
  knownFunctionReturnTypes?: Map<string, string>,
  knownObjectTypes?: Map<string, string>,
  knownObjectFieldTypes?: Map<string, Map<string, string>>,
): string {
  if (value.kind === "number") {
    return Number.isInteger(value.value) ? "int" : "float";
  }

  if (value.kind === "boolean") {
    return "bool";
  }

  if (value.kind === "string") {
    return "const char*";
  }

  if (value.kind === "identifier") {
    if (knownObjectTypes && knownObjectTypes.has(value.value)) {
      return knownObjectTypes.get(value.value)!;
    }
    if (value.value === "Pins") {
      return "_Pins_t";
    }
    // Check if this identifier is a known pointer variable
    if (pointerVarTypes && pointerVarTypes.has(value.value)) {
      return pointerVarTypes.get(value.value)!;
    }
    return "int";
  }

  // For enum member access (e.g. I2CSpeed.STANDARD), return `long` if the
  // enum has values outside AVR's 16-bit int range, otherwise `int`.
  if (value.kind === "property-access" && value.object.kind === "identifier") {
    return _largeEnumNames.has(value.object.value) ? "long" : "int";
  }

  if (value.kind === "raw") {
    const memberAccessMatch = value.value.match(/^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/);
    if (memberAccessMatch && knownObjectFieldTypes) {
      const objectName = memberAccessMatch[1];
      const fieldName = memberAccessMatch[2];
      const fields = knownObjectFieldTypes.get(objectName);
      if (fields?.has(fieldName)) {
        return fields.get(fieldName)!;
      }
      if (objectName === "Pins") {
        if (fieldName === "D2") {
          return "AVRInterruptPin*";
        }
        if (fieldName === "D3") {
          return "AVRPWMInterruptPin*";
        }
        if (["D3", "D5", "D6", "D9", "D10", "D11"].includes(fieldName)) {
          return "AVRPWMPin*";
        }
        if (/^A\d+$/.test(fieldName)) {
          return "AVRAnalogPin*";
        }
        if (/^D\d+$/.test(fieldName) || fieldName === "LED") {
          return "AVRDigitalPin*";
        }
      }
    }

    const newMatch = value.value.match(/^new\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (newMatch) {
      return `${newMatch[1]}*`;
    }

    const callMatch = value.value.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (callMatch && knownFunctionReturnTypes) {
      const inferred = knownFunctionReturnTypes.get(callMatch[1]);
      if (inferred) {
        return inferred;
      }
    }
  }

  if (value.kind === "array") {
    const elementKinds = value.elements.map((element) => element.kind);
    let elementType = "int";
    if (elementKinds.includes("string")) {
      elementType = "const char*";
    } else if (value.elements.some((element) => element.kind === "number" && !Number.isInteger((element as Extract<ExpressionIR, { kind: "number" }>).value))) {
      elementType = "float";
    } else if (elementKinds.includes("boolean") && !elementKinds.includes("number")) {
      elementType = "bool";
    }

    return `std::vector<${elementType}>`;
  }

  return "int";
}

function hasArrayInObjectLiteral(program: ProgramIR): boolean {
  const hasArray = (expr: ExpressionIR): boolean => {
    if (expr.kind === "array") {
      return true;
    }

    if (expr.kind === "object") {
      return expr.fields.some((field) => hasArray(field.value));
    }

    if (expr.kind === "ternary") {
      return hasArray(expr.condition) || hasArray(expr.whenTrue) || hasArray(expr.whenFalse);
    }

    return false;
  };

  const hasArrayInStatement = (statement: StatementIR): boolean => {
    if (statement.kind === "var_decl" && statement.initializer) {
      return hasArray(statement.initializer);
    }
    if (statement.kind === "assign") {
      return hasArray(statement.value);
    }
    if (statement.kind === "return" && statement.value) {
      return hasArray(statement.value);
    }
    if (statement.kind === "call") {
      return statement.args.some((arg) => hasArray(arg));
    }
    return false;
  };

  if (program.topLevelStatements.some((statement) => hasArrayInStatement(statement))) {
    return true;
  }

  for (const fn of program.functions) {
    if (fn.statements.some((statement) => hasArrayInStatement(statement))) {
      return true;
    }
  }

  for (const classDef of program.classes) {
    if (classDef.fields.some((field) => field.initializer ? hasArray(field.initializer) : false)) {
      return true;
    }
    for (const method of classDef.methods) {
      if (method.statements.some((statement) => hasArrayInStatement(statement))) {
        return true;
      }
    }
    if (classDef.constructor && classDef.constructor.statements.some((statement) => hasArrayInStatement(statement))) {
      return true;
    }
  }

  return false;
}

function hasThrowStatements(program: ProgramIR): boolean {
  const statementHasThrow = (statement: StatementIR): boolean => {
    if (statement.kind === "throw") {
      return true;
    }

    if (statement.kind === "while" || statement.kind === "do_while") {
      return statement.body.some(statementHasThrow);
    }

    if (statement.kind === "for" || statement.kind === "for_of" || statement.kind === "for_in") {
      return statement.body.some(statementHasThrow);
    }

    if (statement.kind === "if") {
      return statement.thenBranch.some(statementHasThrow) || (statement.elseBranch?.some(statementHasThrow) ?? false);
    }

    if (statement.kind === "switch") {
      return statement.cases.some((caseClause) => caseClause.body.some(statementHasThrow));
    }

    if (statement.kind === "try") {
      return statement.tryBlock.some(statementHasThrow) || (statement.catchBlock?.some(statementHasThrow) ?? false);
    }

    return false;
  };

  if (program.topLevelStatements.some(statementHasThrow)) {
    return true;
  }

  for (const fn of program.functions) {
    if (fn.statements.some(statementHasThrow)) {
      return true;
    }
  }

  for (const classDef of program.classes) {
    if (classDef.methods.some((method) => method.statements.some(statementHasThrow))) {
      return true;
    }
    if (classDef.constructor && classDef.constructor.statements.some(statementHasThrow)) {
      return true;
    }
  }

  return false;
}

function hasStdMathCalls(program: ProgramIR): boolean {
  const mathPattern = /\bstd::(floor|ceil|round|trunc|sqrt|pow|sin|cos|tan|asin|acos|atan|abs|max|min)\b/;

  const expressionHasMath = (expr: ExpressionIR): boolean => {
    if (expr.kind === "raw") {
      return mathPattern.test(expr.value);
    }
    if (expr.kind === "await") {
      return expressionHasMath(expr.value);
    }
    if (expr.kind === "ternary") {
      return expressionHasMath(expr.condition) || expressionHasMath(expr.whenTrue) || expressionHasMath(expr.whenFalse);
    }
    if (expr.kind === "array") {
      return expr.elements.some(expressionHasMath);
    }
    if (expr.kind === "object") {
      return expr.fields.some((field) => expressionHasMath(field.value));
    }
    if (expr.kind === "instanceof") {
      return expressionHasMath(expr.object);
    }
    if (expr.kind === "spread_array") {
      return expressionHasMath(expr.spreadExpr) || expr.additionalElements.some(expressionHasMath);
    }
    return false;
  };

  const statementHasMath = (statement: StatementIR): boolean => {
    if (statement.kind === "call") {
      return statement.args.some(expressionHasMath);
    }
    if (statement.kind === "var_decl") {
      return statement.initializer ? expressionHasMath(statement.initializer) : false;
    }
    if (statement.kind === "assign") {
      return expressionHasMath(statement.value);
    }
    if (statement.kind === "return") {
      return statement.value ? expressionHasMath(statement.value) : false;
    }
    if (statement.kind === "while" || statement.kind === "do_while") {
      return expressionHasMath(statement.condition) || statement.body.some(statementHasMath);
    }
    if (statement.kind === "if") {
      return expressionHasMath(statement.condition) || statement.thenBranch.some(statementHasMath) || (statement.elseBranch?.some(statementHasMath) ?? false);
    }
    if (statement.kind === "for") {
      return (statement.initializer ? statementHasMath(statement.initializer) : false)
        || (statement.condition ? expressionHasMath(statement.condition) : false)
        || (statement.increment ? statementHasMath(statement.increment) : false)
        || statement.body.some(statementHasMath);
    }
    if (statement.kind === "for_of") {
      return statementHasMath(statement.variable) || expressionHasMath(statement.iterable) || statement.body.some(statementHasMath);
    }
    if (statement.kind === "for_in") {
      return statementHasMath(statement.variable) || expressionHasMath(statement.object) || statement.body.some(statementHasMath);
    }
    if (statement.kind === "switch") {
      return expressionHasMath(statement.expression) || statement.cases.some((caseClause) =>
        (caseClause.value ? expressionHasMath(caseClause.value) : false) || caseClause.body.some(statementHasMath)
      );
    }
    if (statement.kind === "try") {
      return statement.tryBlock.some(statementHasMath) || (statement.catchBlock?.some(statementHasMath) ?? false);
    }
    if (statement.kind === "throw") {
      return expressionHasMath(statement.value);
    }
    return false;
  };

  if (program.topLevelStatements.some(statementHasMath)) {
    return true;
  }
  if (program.functions.some((fn) => fn.statements.some(statementHasMath))) {
    return true;
  }
  for (const classDef of program.classes) {
    if (classDef.methods.some((method) => method.statements.some(statementHasMath))) {
      return true;
    }
    if (classDef.constructor && classDef.constructor.statements.some(statementHasMath)) {
      return true;
    }
  }
  return false;
}

function applySymbolMap(callee: string, symbolMap: Record<string, string>): string {
  const firstDot = callee.indexOf(".");
  if (firstDot === -1) {
    return symbolMap[callee] ?? callee;
  }

  const root = callee.slice(0, firstDot);
  const rest = callee.slice(firstDot);
  return `${symbolMap[root] ?? root}${rest}`;
}

function renderBoilerplate(program: ProgramIR): string {
  const chunks: string[] = [];

  if (program.boilerplates.has("async_stub")) {
    chunks.push("struct TsAsyncTask { bool done = true; };\n");
  }

  return chunks.join("\n");
}

// ---------------------------------------------------------------------------
// Async state-machine helpers
// ---------------------------------------------------------------------------

function toPascalCaseLocal(str: string): string {
  return str
    .split(/[_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

/**
 * Generates a cooperative state-machine class for an async function.
 *
 * Handles two patterns:
 *   1. Cyclic: single `while(true)` body containing `await delay()` calls.
 *   2. Linear: sequential statements with `await delay()` calls.
 *
 * Each `await delay(ms)` call becomes a timed wait state that polls `millis()`.
 */
function generateAsyncTaskClass(
  fnName: string,
  fnStatements: StatementIR[],
  strategy: PlatformStrategy,
  knownFunctionReturnTypes: Map<string, string>,
): { classDef: string; instanceDecl: string } {
  const className = toPascalCaseLocal(fnName) + "Task";
  const instanceName = `${fnName}Task`;

  // Detect whether the body is a single while-loop (cyclic) or linear statements
  let bodyStatements: StatementIR[];
  let isCyclic = false;

  if (fnStatements.length === 1 && fnStatements[0].kind === "while") {
    isCyclic = true;
    bodyStatements = (fnStatements[0] as any).body as StatementIR[];
  } else {
    bodyStatements = fnStatements;
  }

  // Split body into segments at each awaited call
  interface Segment {
    preStatements: StatementIR[];
    awaitedCallee?: string;
    awaitedArgs: ExpressionIR[];
  }

  const segments: Segment[] = [];
  let currentPre: StatementIR[] = [];

  for (const stmt of bodyStatements) {
    if (stmt.kind === "call" && (stmt as any).isAwaited) {
      segments.push({ preStatements: currentPre, awaitedCallee: stmt.callee, awaitedArgs: stmt.args });
      currentPre = [];
    } else {
      currentPre.push(stmt);
    }
  }
  // Terminal segment (trailing statements after the last await, or the whole body if no awaits)
  segments.push({ preStatements: currentPre, awaitedArgs: [] });

  const awaitCount = segments.filter((s) => s.awaitedCallee !== undefined).length;
  const stateCount = awaitCount + 1; // STATE_0 … STATE_{awaitCount}; cyclic loops back, linear adds STATE_DONE

  const stateNames: string[] = [];
  for (let i = 0; i < stateCount; i++) stateNames.push(`STATE_${i}`);
  if (!isCyclic) stateNames.push("STATE_DONE");

  // Helper: render a non-await statement as a single C++ line
  const renderStmt = (stmt: StatementIR): string =>
    renderStatement(stmt, false, strategy, undefined, undefined, knownFunctionReturnTypes);

  const caseLines: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const stateName = `STATE_${i}`;
    const isTerminal = seg.awaitedCallee === undefined;
    const body: string[] = [];

    if (i === 0) {
      // STATE_0: execute immediately, no millis check
      for (const stmt of seg.preStatements) body.push(`        ${renderStmt(stmt)}`);
      if (!isTerminal) {
        const ms = seg.awaitedArgs[0] ? renderExpression(seg.awaitedArgs[0], undefined, strategy) : "0";
        body.push(`        _waitUntil = millis() + ${ms};`);
        body.push(`        _state = STATE_${i + 1};`);
      } else {
        body.push(`        _state = ${isCyclic ? "STATE_0" : "STATE_DONE"};`);
      }
    } else {
      // STATE_i (i >= 1): poll millis, then execute segment
      body.push(`        if (millis() >= _waitUntil) {`);
      for (const stmt of seg.preStatements) body.push(`          ${renderStmt(stmt)}`);
      if (!isTerminal) {
        const ms = seg.awaitedArgs[0] ? renderExpression(seg.awaitedArgs[0], undefined, strategy) : "0";
        body.push(`          _waitUntil = millis() + ${ms};`);
        body.push(`          _state = STATE_${i + 1};`);
      } else {
        body.push(`          _state = ${isCyclic ? "STATE_0" : "STATE_DONE"};`);
      }
      body.push(`        }`);
    }

    caseLines.push(`      case ${stateName}:`, ...body, `        break;`);
  }

  if (!isCyclic) caseLines.push(`      case STATE_DONE:`, `        break;`);

  const stateEnumList = stateNames.join(", ");
  const isCompleteExpr = isCyclic ? "false" : "_state == STATE_DONE";

  const classDef = [
    `// Async state machine for ${fnName}`,
    `class ${className} {`,
    `public:`,
    `  enum State { ${stateEnumList} };`,
    `  ${className}() : _state(STATE_0), _waitUntil(0) {}`,
    `  void run() {`,
    `    switch (_state) {`,
    ...caseLines,
    `    }`,
    `  }`,
    `  bool isComplete() const { return ${isCompleteExpr}; }`,
    `  void reset() { _state = STATE_0; _waitUntil = 0; }`,
    `private:`,
    `  State _state;`,
    `  unsigned long _waitUntil;`,
    `};`,
  ].join("\n");

  return { classDef, instanceDecl: `${className} ${instanceName};` };
}
/**
 * Check if an expression requires runtime execution (cannot be evaluated at global scope in C++)
 */
function isRuntimeExpression(expr: ExpressionIR): boolean {
  // Safety check
  if (!expr || typeof expr !== 'object' || !expr.kind) {
    return false;
  }
  
  switch (expr.kind) {
    case "number":
    case "string":
    case "boolean":
      // Literals are compile-time constants
      return false;
    
    case "identifier":
      // Simple identifiers might be compile-time constants, but could also be
      // runtime values. We'll be conservative and allow them at global scope
      // since they might reference constants.
      return false;
    
    case "array":
      // Arrays are okay at global scope if all elements are compile-time
      return expr.elements.some((e) => isRuntimeExpression(e));
    
    case "object":
      // Object literals with runtime values need runtime execution
      // Also, object literals with identifier fields need runtime execution
      // because they may reference runtime-created variables (like pointers from 'new')
      return expr.fields.some((f) => isRuntimeExpression(f.value) || f.value.kind === "identifier");
    
    case "raw":
      // Raw expressions might contain method calls - check for common patterns
      // Look for function/method call patterns: identifier(...) or ...(...)
      const rawValue = expr.value;
      // Check for call patterns: ends with ) and contains ( not at start
      if (rawValue.includes("(") && rawValue.includes(")")) {
        // Has function call syntax - likely runtime
        return true;
      }
      // Check for 'new' keyword
      if (rawValue.startsWith("new ") || rawValue.includes(" new ")) {
        return true;
      }
      return false;
    
    case "await":
      // Await expressions are definitely runtime
      return true;
    
    case "ternary":
      // Ternary expressions are runtime if any part is runtime
      return (
        isRuntimeExpression(expr.condition) ||
        isRuntimeExpression(expr.whenTrue) ||
        isRuntimeExpression(expr.whenFalse)
      );
    
    case "instanceof":
      // instanceof requires RTTI and runtime evaluation
      return true;
    
    case "spread_array":
      // Spread operations are runtime
      return true;
    
    default:
      // Unknown expression types - be conservative
      return true;
  }
}

/**
 * Check if a statement requires runtime execution
 */
function statementRequiresRuntime(statement: StatementIR): boolean {
  if (statement.kind === "var_decl") {
    // Variable declaration requires runtime if its initializer does
    return statement.initializer ? isRuntimeExpression(statement.initializer) : false;
  }
  // All other statement types (calls, assignments, etc.) are runtime
  return true;
}

function hasConsoleCalls(program: ProgramIR): boolean {
  const checkStatements = (statements: StatementIR[]): boolean => {
    for (const stmt of statements) {
      if (stmt.kind === "call" && isConsoleCall(stmt.callee)) {
        return true;
      }
      // Check nested statements in control flow
      if ("body" in stmt && Array.isArray(stmt.body)) {
        if (checkStatements(stmt.body)) return true;
      }
      if ("thenBranch" in stmt && Array.isArray(stmt.thenBranch)) {
        if (checkStatements(stmt.thenBranch)) return true;
      }
      if ("elseBranch" in stmt && Array.isArray(stmt.elseBranch)) {
        if (checkStatements(stmt.elseBranch)) return true;
      }
      if ("cases" in stmt && Array.isArray(stmt.cases)) {
        for (const c of stmt.cases) {
          if (checkStatements(c.body)) return true;
        }
      }
      if ("tryBlock" in stmt && Array.isArray(stmt.tryBlock)) {
        if (checkStatements(stmt.tryBlock)) return true;
      }
      if ("catchBlock" in stmt && Array.isArray(stmt.catchBlock)) {
        if (checkStatements(stmt.catchBlock)) return true;
      }
    }
    return false;
  };

  // Check all functions
  for (const fn of program.functions) {
    if (checkStatements(fn.statements)) return true;
  }
  // Check top-level statements
  if (checkStatements(program.topLevelStatements)) return true;
  // Check class methods
  for (const cls of program.classes) {
    for (const method of cls.methods) {
      if (checkStatements(method.statements)) return true;
    }
    if (cls.constructor && checkStatements(cls.constructor.statements)) return true;
  }
  return false;
}

function normalizeInclude(include: string): string {
  if (include.startsWith("<") || include.startsWith("\"")) {
    return include;
  }
  return `<${include}>`;
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function renderParameters(
  parameters: Array<{ name: string; cppType: string; defaultValue?: any }>,
  strategy: PlatformStrategy = _defaultStrategy,
): string {
  if (parameters.length === 0) {
    return "";
  }

  return parameters
    .map((parameter) => {
      const paramOwnershipKind = (parameter as any).ownershipKind as 'owned' | 'ref' | 'mut_ref' | undefined;
      const isConst = paramOwnershipKind === 'ref';
      const isRef = (paramOwnershipKind === 'ref' || paramOwnershipKind === 'mut_ref')
        && !isPrimitiveCppType(parameter.cppType);
      let result = renderTypedName(parameter.cppType, parameter.name, strategy, isConst, isRef);
      if (parameter.defaultValue) {
        result += ` = ${renderExpression(parameter.defaultValue, undefined, strategy)}`;
      }
      return result;
    })
    .join(", ");
}

/**
 * Check if a callee is a console method call (e.g., "console.log", "console.error")
 */
function isConsoleCall(callee: string): boolean {
  return callee.startsWith("console.");
}

/**
 * Get the console method name from a callee (e.g., "log" from "console.log")
 */
function getConsoleMethod(callee: string): string {
  return callee.slice("console.".length);
}

/**
 * Transform console.log/error/warn calls based on target platform.
 * Delegates to the active strategy.
 */
function transformConsoleCall(
  callee: string,
  args: ExpressionIR[],
  strategy: PlatformStrategy,
  forHeader: boolean,
  scopeState?: EmissionScopeState,
  pointerVarTypes?: Map<string, string>,
  knownFunctionReturnTypes?: Map<string, string>,
): string {
  const method = getConsoleMethod(callee);
  
  // For Arduino, check if any argument is a string_concat that should use snprintf
  if (strategy.id === "arduino" && args.length > 0) {
    const firstArg = args[0];
    if (firstArg.kind === "string_concat" && scopeState) {
      const snprintfRender = buildSnprintfRenderResult(
        firstArg,
        strategy,
        scopeState,
        (expression) => renderExpression(expression, undefined, strategy),
        pointerVarTypes,
        knownFunctionReturnTypes,
      );

      if (snprintfRender) {
        // Generate a temporary buffer for snprintf
        const bufferName = `__typecode_println_${++scopeState.nextSnprintfTempId}`;
        const prelude = snprintfRender.preludeLines.length > 0
          ? snprintfRender.preludeLines.join(" ") + " "
          : "";
        const snprintfCall = `char ${bufferName}[${snprintfRender.estimatedLength}]; ${prelude}snprintf(${bufferName}, sizeof(${bufferName}), "${snprintfRender.formatString}"${snprintfRender.args.length > 0 ? `, ${snprintfRender.args.join(", ")}` : ""})`;
        return strategy.transformConsoleCall(method, snprintfCall, forHeader);
      }
    }
  }
  
  // Fallback to regular rendering
  const renderedArgs = args.map((arg) => renderExpression(arg, undefined, strategy)).join(", ");
  return strategy.transformConsoleCall(method, renderedArgs, forHeader);
}

/**
 * Collect pointer variable types from program statements
 * Variables initialized with 'new ClassName()' get type 'ClassName*'
 * Uses Arduino class name mapping to get fully qualified names with namespaces
 */
function collectPointerVarTypes(statements: StatementIR[], classNameMap?: Map<string, string>): Map<string, string> {
  const pointerVarTypes = new Map<string, string>();
  
  for (const statement of statements) {
    if (statement.kind === "var_decl" && statement.initializer) {
      const init = statement.initializer;
      // Check for raw expression containing 'new'
      if (init.kind === "raw" && init.value.startsWith("new ")) {
        // Extract class name from 'new ClassName(...)'
        const match = init.value.match(/^new\s+(\w+)/);
        if (match) {
          const simpleName = match[1];
          // Use fully qualified name if available (for namespaced classes)
          const fullName = classNameMap?.get(simpleName) ?? simpleName;
          pointerVarTypes.set(statement.name, `${fullName}*`);
        }
      }
    }
  }
  
  return pointerVarTypes;
}

function renderStatement(
  statement: StatementIR,
  forHeader: boolean = false,
  strategy: PlatformStrategy = _defaultStrategy,
  pointerVarTypes?: Map<string, string>,
  calleeTransformer?: (callee: string) => string,
  knownFunctionReturnTypes?: Map<string, string>,
): string {
  if (statement.kind === "typecode-call") {
    // Handle typecode-call statements (from fluent chains like UART0.config.baudRate(115200).begin())
    const renderA = (e: ExpressionIR) => renderExpression(e, undefined, strategy);
    const translated = strategy.tryRenderTypecodeCall(
      statement.receiver,
      statement.receiverKind,
      statement.method,
      statement.args,
      renderA,
      _emitBoardConstants,
      (statement as any).interruptMode
    );
    if (translated !== undefined) {
      return forHeader ? translated : `${translated};`;
    }
    // Fallback: render as plain method call
    return forHeader
      ? `${statement.receiver}.${statement.method}(${statement.args.map(renderA).join(", ")})`
      : `${statement.receiver}.${statement.method}(${statement.args.map(renderA).join(", ")});`;
  }

  if (statement.kind === "call") {
    // Handle raw statements from setupInitCode
    if (statement.callee.startsWith('__RAW_STMT__')) {
      const rawStmt = statement.callee.slice('__RAW_STMT__'.length);
      return forHeader ? rawStmt : `${rawStmt.endsWith(';') ? rawStmt : rawStmt + ';'}`;
    }
    // Handle console.* calls specially
    if (isConsoleCall(statement.callee)) {
      return transformConsoleCall(statement.callee, statement.args, strategy, forHeader);
    }
    // Handle typecode SDK calls via strategy (pin/serial/i2c/spi)
    const renderA = (e: ExpressionIR) => renderExpression(e, undefined, strategy);
    const translated = strategy.tryRenderCallStatement(statement.callee, statement.args, renderA, _emitBoardConstants);
    if (translated !== undefined) {
      return forHeader ? translated : `${translated};`;
    }
    let callee = statement.callee;
    if (callee.startsWith("this.")) {
      callee = `this->${callee.slice("this.".length)}`;
    }
    if (calleeTransformer) {
      callee = calleeTransformer(callee);
    }
    callee = normalizeRawExpression(callee, strategy);
    const renderedArgs = statement.args.map((arg) => renderExpression(arg, undefined, strategy)).join(", ");
    return forHeader ? `${callee}(${renderedArgs})` : `${callee}(${renderedArgs});`;
  }

  if (statement.kind === "assign") {
    return forHeader 
      ? `${statement.target} ${statement.operator} ${renderExpression(statement.value, undefined, strategy)}`
      : `${statement.target} ${statement.operator} ${renderExpression(statement.value, undefined, strategy)};`;
  }

  if (statement.kind === "update") {
    return statement.prefix
      ? `${statement.operator}${statement.target}${forHeader ? "" : ";"}`
      : `${statement.target}${statement.operator}${forHeader ? "" : ";"}`;
  }

  if (statement.kind === "return") {
    return statement.value ? `return ${renderExpression(statement.value, undefined, strategy)};` : "return;";
  }

  if (statement.kind === "while") {
    return `while (${renderExpression(statement.condition, undefined, strategy)})`;
  }

  if (statement.kind === "if") {
    return `if (${renderExpression(statement.condition, undefined, strategy)})`;
  }

  if (statement.kind === "for") {
    const init = statement.initializer ? renderStatement(statement.initializer, true) : "";
    const cond = statement.condition ? renderExpression(statement.condition, undefined, strategy) : "";
    const incr = statement.increment ? renderStatement(statement.increment, true) : "";
    return `for (${init}; ${cond}; ${incr})`;
  }

  if (statement.kind === "for_of") {
    const varDecl = statement.variable;
    if (varDecl.kind === "var_decl") {
      return `for (${renderTypedName(varDecl.cppType, varDecl.name, strategy, varDecl.storage === "const")} : ${renderExpression(statement.iterable, undefined, strategy)})`;
    }
    return `for (auto item : ${renderExpression(statement.iterable, undefined, strategy)})`;
  }

  if (statement.kind === "for_in") {
    // for...in iterates over object keys
    // In C++, we need to use a map iterator or similar pattern
    const varDecl = statement.variable;
    if (varDecl.kind === "var_decl") {
      // Use a key iteration pattern - the object should be a map-like structure
      return `for (${renderTypedName(varDecl.cppType, varDecl.name, strategy, varDecl.storage === "const")} : ${renderExpression(statement.object, undefined, strategy)})`;
    }
    return `for (auto key : ${renderExpression(statement.object, undefined, strategy)})`;
  }

  if (statement.kind === "break") {
    return "break;";
  }

  if (statement.kind === "continue") {
    return "continue;";
  }

  if (statement.kind === "do_while") {
    return `do`;
  }

  if (statement.kind === "switch") {
    return `switch (${renderExpression(statement.expression, undefined, strategy)})`;
  }

  if (statement.kind === "try") {
    return "try";
  }

  if (statement.kind === "throw") {
    return strategy.renderThrow(renderExpression(statement.value, undefined, strategy));
  }

  if (statement.kind === "labeled") {
    // Labeled statements: label: { ... } or label: statement
    return `${statement.label}:`;
  }

  if (statement.kind === "block") {
    // Standalone block: { ... }
    return `{`;
  }

  if (statement.kind !== "var_decl") {
    return "/* unsupported_statement */";
  }

  const declaredType = normalizeCppTypeForTarget(statement.cppType, strategy);
  const volatilePrefix = statement.isVolatile ? "volatile " : "";
  // Transform type name for Arduino library classes (add namespace prefix)
  const transformedType = transformTypeName(statement.cppType, _arduinoClassNameMap);
  const ownershipKind = (statement as any).ownershipKind as 'owned' | 'ref' | 'mut_ref' | undefined;
  const isConstDecl = statement.storage === "const" || ownershipKind === 'ref';
  const isRefDecl = (ownershipKind === 'ref' || ownershipKind === 'mut_ref')
    && !isPrimitiveCppType(statement.cppType)
    && statement.initializer?.kind === 'identifier';
  const declaration = `${volatilePrefix}${renderTypedName(transformedType, statement.name, strategy, isConstDecl, isRefDecl)}`;
  if (statement.initializer) {
    // Handle array initializers
    if (statement.initializer.kind === "array") {
      const elements = statement.initializer.elements.map((e) => renderExpression(e, calleeTransformer, strategy)).join(", ");
      if (declaredType.startsWith("std::vector<")) {
        return forHeader
          ? `${declaration} = { ${elements} }`
          : `${declaration} = { ${elements} };`;
      }
      // Use "int" for "auto" element type since C arrays need explicit types
      const arrayType = statement.initializer.elementType === "auto" ? "int" : statement.initializer.elementType;
      return forHeader 
        ? `${arrayType} ${statement.name}[] = { ${elements} }`
        : `${arrayType} ${statement.name}[] = { ${elements} };`;
    }
    // Handle object initializers with inline struct definition
    if (statement.initializer.kind === "object") {
      const structName = `_${statement.name}_t`;
      const fieldDefs = statement.initializer.fields
        .map((f) => `${inferObjectFieldType(f.value, pointerVarTypes, knownFunctionReturnTypes)} ${f.name};`)
        .join(" ");
      const initValues = statement.initializer.fields
        .map((f) => {
          const renderExpr = (e: ExpressionIR) => renderExpression(e, calleeTransformer, strategy);
          const overridden = strategy.objectFieldInitializer(f.value, renderExpr);
          if (overridden !== undefined) return overridden;
          return renderExpr(f.value);
        })
        .join(", ");
      return forHeader
        ? `struct ${structName} { ${fieldDefs} } ${statement.name} = { ${initValues} }`
        : `struct ${structName} { ${fieldDefs} } ${statement.name} = { ${initValues} };`;
    }
    // Handle spread array initializers
    if (statement.initializer.kind === "spread_array") {
      // For spread arrays, we need to copy the source array and append additional elements
      // Since C++ doesn't have native spread, we create a larger array with all elements
      const arrayType = statement.initializer.elementType === "auto" ? "int" : statement.initializer.elementType;
      const spreadName = renderExpression(statement.initializer.spreadExpr, calleeTransformer, strategy);
      const additionalElements = statement.initializer.additionalElements.map(e => renderExpression(e, calleeTransformer, strategy)).join(", ");
      // Emit a comment indicating the spread behavior - for full support would need runtime helper
      return forHeader
        ? `${arrayType} ${statement.name}[] = { /* spread from ${spreadName} */ ${additionalElements} }`
        : `${arrayType} ${statement.name}[] = { /* spread from ${spreadName} */ ${additionalElements} };`;
    }
    return forHeader 
      ? `${declaration} = ${renderExpression(statement.initializer, calleeTransformer, strategy)}`
      : `${declaration} = ${renderExpression(statement.initializer, calleeTransformer, strategy)};`;
  }

  return forHeader ? declaration : `${declaration};`;
}

/**
 * Resolves an import to a local header file if it's from a transpiled npm package
 */
function resolveTranspiledModuleInclude(
  moduleSpecifier: string,
  npmPackages: Map<string, ResolvedNpmPackage> | undefined,
  fromFilePath: string
): { include: string; isTranspiled: boolean } {
  if (!npmPackages || npmPackages.size === 0) {
    return { include: "", isTranspiled: false };
  }

  if (moduleSpecifier.startsWith(".")) {
    const normalizedSpecifier = moduleSpecifier.endsWith(".js")
      ? `${moduleSpecifier.slice(0, -3)}.ts`
      : moduleSpecifier.endsWith(".mjs")
        ? `${moduleSpecifier.slice(0, -4)}.ts`
        : moduleSpecifier;

    const basePath = path.resolve(path.dirname(fromFilePath), normalizedSpecifier);
    const candidates = [
      basePath,
      `${basePath}.ts`,
      `${basePath}.tsx`,
      path.join(basePath, "index.ts"),
      path.join(basePath, "index.tsx"),
    ].map((candidate) => path.resolve(candidate));

    for (const candidate of candidates) {
      const pkg = npmPackages.get(candidate);
      if (!pkg) {
        continue;
      }
      const currentPkg = npmPackages.get(path.resolve(fromFilePath));
      let headerName = `${pkg.moduleKey}.h`;
      if (currentPkg) {
        const currentDir = path.posix.dirname(currentPkg.moduleKey.replace(/\\/g, "/"));
        const targetPath = `${pkg.moduleKey.replace(/\\/g, "/")}.h`;
        let relativeHeader = path.posix.relative(currentDir, targetPath);
        if (!relativeHeader.startsWith(".")) {
          relativeHeader = `./${relativeHeader}`;
        }
        headerName = relativeHeader;
      }
      return { include: `"${headerName}"`, isTranspiled: true };
    }

    return { include: "", isTranspiled: false };
  }
  
  // Parse the module specifier to get package name and subpath
  const parts = moduleSpecifier.split("/");
  let packageName: string;
  let subpath: string;
  
  if (moduleSpecifier.startsWith("@")) {
    packageName = parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0];
    subpath = parts.length > 2 ? parts.slice(2).join("/") : "";
  } else {
    packageName = parts[0];
    subpath = parts.length > 1 ? parts.slice(1).join("/") : "";
  }
  
  // Look for a matching npm package in our transpiled modules
  // The npmPackages map is keyed by source path, so we need to iterate
  for (const [sourcePath, pkg] of npmPackages) {
    // Match by package name (e.g., "@typecode/core" or "typecode-implementation")
    if (pkg.packageName === packageName) {
      // Use the moduleKey from the package info, which is already computed
      const headerName = `${pkg.moduleKey}.h`;
      return { include: `"${headerName}"`, isTranspiled: true };
    }
  }
  
  return { include: "", isTranspiled: false };
}

export function emitCpp(program: ProgramIR, options: EmitterOptions): GeneratedOutputs {
  // Make board constants available to the nested renderExpression function.
  _emitBoardConstants = program.boardConstants;
  // Accumulate enum class names so property-access rendering can use :: for enums.
  for (const e of program.enums) {
    _emitEnumNames.add(e.name);
    if (e.members.some(m => m.value !== undefined && (m.value > 32767 || m.value < -32768))) {
      _largeEnumNames.add(e.name);
    }
  }

  // Resolve the platform strategy for this target.
  const strategy: PlatformStrategy = options.strategy ?? resolveStrategy(options.target ?? "generic");
  // Inform ArduinoStrategy about large enum names so it can decide on underlying type.
  if (typeof (strategy as any).setLargeEnumNames === "function") {
    (strategy as any).setLargeEnumNames(_largeEnumNames);
  }

  ensureDir(options.outDir);

  // Build class name mapping for Arduino library imports (for namespace resolution)
  _arduinoClassNameMap = buildArduinoClassNameMap(program.imports);

  // Perform single-pass program analysis to replace multiple traversals
  const programAnalysis = analyzeProgram(program);

  // For npm package files, use the moduleKey as the base name
  // For entry files, use the original filename
  const originalBaseName = path.basename(program.fileName).replace(/\.[^.]+$/, "");
  const outDirBaseName = path.basename(path.resolve(options.outDir));
  const baseName = options.npmPackage?.moduleKey
    || strategy.overrideBaseName(originalBaseName, outDirBaseName, options.isEntryFile ?? true, !!options.npmPackage);
  
  // Determine emit mode and extensions
  // For npm packages, always emit .h/.cpp (not .ino)
  const isNpmPackage = !!options.npmPackage;
  const isEntryFile = options.isEntryFile !== false;
  const effectiveEmitMode: EmitMode = strategy.effectiveEmitMode(options.emitMode, isNpmPackage) as EmitMode;
  const sourceExtension = strategy.sourceExtension(isEntryFile, isNpmPackage);
  const headerPath = path.join(options.outDir, `${baseName}.h`);
  const sourcePath = path.join(options.outDir, `${baseName}.${sourceExtension}`);

  const includes: string[] = [];
  const symbolMap: Record<string, string> = {};
  let profileDiagnostics: Diagnostic[] = [];
  let shimLines: string[] = [];
  
  // Get polyfills that the strategy handles natively
  const nativePolyfillIds = strategy.nativePolyfills?.() ?? new Set<string>();
  
  // Filter out polyfills that are handled natively by the strategy
  const filteredPolyfills = (options.polyfills ?? []).filter(
    (polyfill) => !nativePolyfillIds.has(polyfill.id)
  );
  
  // Get native polyfill implementations from the strategy
  const nativePolyfills = strategy.generateNativePolyfills?.(program, options.platformContext) ?? [];
  
  // Merge filtered and native polyfills, then emit
  const allPolyfills = [...filteredPolyfills, ...nativePolyfills];
  const emittedPolyfills = allPolyfills.length > 0
    ? emitPolyfillBoilerplate(allPolyfills)
    : undefined;
  const hasAsyncRuntime = filteredPolyfills.some((polyfill) => polyfill.id === "async_arduino");
  // True only when the Promise/MicrotaskQueue runtime was emitted (requires C++ stdlib).
  // On AVR this is false; ts2cpp_pump_microtasks() must NOT be called.
  const hasPromiseRuntime = filteredPolyfills.some(
    (polyfill) => polyfill.id === "async_arduino" && (polyfill as any).hasPromiseRuntime === true
  );

  if (!isNpmPackage) {
    includes.push(...strategy.forcedIncludes(program, options.platformContext));
    Object.assign(symbolMap, strategy.symbolAliases(program, options.platformContext));
    shimLines = [...strategy.shimLines(program, options.platformContext)];
    profileDiagnostics = [...strategy.profileDiagnostics(program, options.platformContext)];
  }

  for (const imported of program.imports) {
    // Skip imports from typecode SDK modules — the symbols they export
    // (pin names like A0, D13, LED) are already provided by <Arduino.h>.
    if (isTypecodeSDKImport(imported.moduleSpecifier, program.fileName)) {
      for (const symbol of imported.namedImports) {
        symbolMap[symbol] = symbol;
      }
      continue;
    }

    // Skip native C++ modules - they are merged into the output, not included
    if (options.nativeModules && options.nativeModules.has(imported.moduleSpecifier)) {
      // Keep original symbol names for native modules
      for (const symbol of imported.namedImports) {
        symbolMap[symbol] = symbol;
      }
      continue;
    }

    // First check if this import is from a transpiled npm package
    const transpiledInclude = resolveTranspiledModuleInclude(
      imported.moduleSpecifier,
      options.npmPackages,
      program.fileName
    );
    
    if (transpiledInclude.isTranspiled) {
      includes.push(transpiledInclude.include);
      // Keep original symbol names for transpiled modules
      for (const symbol of imported.namedImports) {
        symbolMap[symbol] = symbol;
      }
    } else {
      // Fall back to libdef resolution
      const resolved = resolveImport(imported, options.libdefs, options.target, options.platformContext, program.fileName);
      includes.push(normalizeInclude(resolved.include));
      Object.assign(symbolMap, resolved.symbolMap);
    }
  }


  // Collect re-export includes for the header file
  const headerIncludes: string[] = [];
  for (const reExport of program.reExports) {
    // First try npm package resolution
    const transpiledInclude = resolveTranspiledModuleInclude(
      reExport.moduleSpecifier,
      options.npmPackages,
      program.fileName
    );
    
    if (transpiledInclude.isTranspiled) {
      headerIncludes.push(transpiledInclude.include);
      continue;
    }
    
    // Handle relative re-exports within npm packages
    // e.g., export * from "./pins.js" in a package index file
    if (reExport.moduleSpecifier.startsWith(".")) {
      // Extract the module name from the relative path
      // Handle paths like "./pins.js", "./subdir/module.js"
      let modulePath = reExport.moduleSpecifier;
      // Remove .js/.mjs extensions
      modulePath = modulePath.replace(/\.js$/, "").replace(/\.mjs$/, "");
      // Get the last segment as the base name
      const segments = modulePath.split("/");
      const baseName = segments[segments.length - 1] || segments[segments.length - 2];
      const headerName = `${baseName}.h`;
      headerIncludes.push(`"${headerName}"`);
    }
  }

  // Set of original async function names — used to suppress their direct emission
  // and to filter them out of top-level setup() calls.
  const asyncFunctionOriginalNames = new Set(
    program.functions.filter((fn) => fn.isAsync).map((fn) => fn.originalName)
  );
  const asyncFunctionMappedNames = new Set(
    program.functions.filter((fn) => fn.isAsync).map((fn) => mapFunctionName(fn.originalName, strategy))
  );

  const mappedFunctions = program.functions.map((fn) => ({
    name: mapFunctionName(fn.originalName, strategy),
    returnType: mapReturnType(mapFunctionName(fn.originalName, strategy), fn.returnType, strategy),
    sourceSpan: fn.sourceSpan,
    leadingComments: fn.leadingComments,
    trailingComments: fn.trailingComments,
    parameters: fn.parameters,
    isAsync: fn.isAsync,
    statements: fn.statements.map((stmt) => {
      if (stmt.kind === "call") {
        return {
          ...stmt,
          callee: applySymbolMap(stmt.callee, symbolMap),
        };
      }

      return stmt;
    }),
  }));

  const knownFunctionReturnTypes = new Map<string, string>();
  for (const fn of mappedFunctions) {
    knownFunctionReturnTypes.set(fn.name, fn.returnType);
  }
  for (const fn of program.functions) {
    knownFunctionReturnTypes.set(fn.originalName, mapReturnType(mapFunctionName(fn.originalName, strategy), fn.returnType, strategy));
  }

  // Pre-build state machine class strings for every async function.
  // These are emitted into the source file after the polyfill runtime definitions.
  const asyncTaskClasses: { classDef: string; instanceDecl: string; taskVarName: string }[] = [];
  if (hasAsyncRuntime) {
    for (const fn of program.functions) {
      if (fn.isAsync) {
        const task = generateAsyncTaskClass(
          fn.originalName,
          fn.statements,
          strategy,
          knownFunctionReturnTypes,
        );
        asyncTaskClasses.push({ ...task, taskVarName: `${fn.originalName}Task` });
      }
    }
  }

  const headerLines: string[] = ["#pragma once", ""];
  const sourceLines: string[] = [];
  const sourceMapEntries: SourceMapEntry[] = [];
  const headerMapEntries: SourceMapEntry[] = [];

  function appendSourceLine(line: string, entry?: { tsSpan: ProgramIR["functions"][number]["sourceSpan"]; nodeKind: string; symbolName?: string }): void {
    sourceLines.push(line);
    if (!entry) {
      return;
    }

    const generatedLine = sourceLines.length;
    sourceMapEntries.push({
      generatedStartLine: generatedLine,
      generatedStartColumn: 1,
      generatedEndLine: generatedLine,
      generatedEndColumn: Math.max(1, line.length + 1),
      tsSpan: entry.tsSpan,
      nodeKind: entry.nodeKind,
      symbolName: entry.symbolName,
    });
  }

  function appendHeaderLine(line: string, entry?: { tsSpan: ProgramIR["functions"][number]["sourceSpan"]; nodeKind: string; symbolName?: string }): void {
    headerLines.push(line);
    if (!entry) {
      return;
    }

    const generatedLine = headerLines.length;
    headerMapEntries.push({
      generatedStartLine: generatedLine,
      generatedStartColumn: 1,
      generatedEndLine: generatedLine,
      generatedEndColumn: Math.max(1, line.length + 1),
      tsSpan: entry.tsSpan,
      nodeKind: entry.nodeKind,
      symbolName: entry.symbolName,
    });
  }

  function appendRenderedStatement(
    statement: StatementIR,
    indent: string,
    pointerVarTypes?: Map<string, string>,
    scopeState: EmissionScopeState = createEmissionScopeState(),
  ): void {
    emitCommentLines(statement.leadingComments, indent, (line) => appendSourceLine(line));

    const emitSnprintfLines = (
      bufferName: string,
      snprintfRender: {
        estimatedLength: number;
        preludeLines: string[];
        formatString: string;
        args: string[];
      },
      options?: { declareBuffer?: boolean; finalLine?: string },
    ): void => {
      for (const preludeLine of snprintfRender.preludeLines) {
        appendSourceLine(`${indent}${preludeLine}`, {
          tsSpan: statement.sourceSpan,
          nodeKind: statement.kind,
        });
      }
      if (options?.declareBuffer ?? false) {
        appendSourceLine(`${indent}char ${bufferName}[${snprintfRender.estimatedLength}];`, {
          tsSpan: statement.sourceSpan,
          nodeKind: statement.kind,
        });
      }
      appendSourceLine(
        `${indent}snprintf(${bufferName}, sizeof(${bufferName}), "${snprintfRender.formatString}"${snprintfRender.args.length > 0 ? `, ${snprintfRender.args.join(", ")}` : ""});`,
        {
          tsSpan: statement.sourceSpan,
          nodeKind: statement.kind,
        },
      );
      if (options?.finalLine) {
        appendSourceLine(`${indent}${options.finalLine}`, {
          tsSpan: statement.sourceSpan,
          nodeKind: statement.kind,
        });
      }
    };

    const renderWithPrelude = (
      statementToRender: StatementIR,
      rendererPointerVarTypes?: Map<string, string>,
      calleeTransformer?: (callee: string) => string,
    ): { prelude: string[]; statement: string } => {
      const statementRenderer = new StatementRenderer({
        strategy,
        boardConstants: _emitBoardConstants,
        arduinoClassNameMap: _arduinoClassNameMap,
        enumNames: _emitEnumNames,
        largeEnumNames: _largeEnumNames,
        knownFunctionReturnTypes,
        pointerVarTypes: rendererPointerVarTypes,
        pointerStructFields,
      });
      return statementRenderer.renderWithPrelude(statementToRender, false, calleeTransformer);
    };

    if (statement.kind === "var_decl" && shouldUseSnprintfForArduinoString(statement, strategy) && statement.initializer) {
      const snprintfRender = buildSnprintfRenderResult(
        statement.initializer,
        strategy,
        scopeState,
        (expression) => renderExpression(expression, undefined, strategy),
        pointerVarTypes,
        knownFunctionReturnTypes,
      );

      if (snprintfRender) {
        emitSnprintfLines(statement.name, snprintfRender, { declareBuffer: true });
        recordVariableType(statement, scopeState);
        scopeState.snprintfBuffers.add(statement.name);
        emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
        return;
      }

    }

    if (
      statement.kind === "assign" &&
      statement.operator === "=" &&
      scopeState.snprintfBuffers.has(statement.target) &&
      shouldUseSnprintfForArduinoString(statement, strategy)
    ) {
      const snprintfRender = buildSnprintfRenderResult(
        statement.value,
        strategy,
        scopeState,
        (expression) => renderExpression(expression, undefined, strategy),
        pointerVarTypes,
        knownFunctionReturnTypes,
      );

      if (snprintfRender) {
        emitSnprintfLines(statement.target, snprintfRender);
        emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
        return;
      }
    }

    // Handle console calls with snprintf for Arduino
    if (statement.kind === "call" && isConsoleCall(statement.callee) && strategy.useSnprintfForStrings() && statement.args.length > 0) {
      const firstArg = statement.args[0];
      if (firstArg.kind === "string_concat") {
        const snprintfRender = buildSnprintfRenderResult(
          firstArg,
          strategy,
          scopeState,
          (expression) => renderExpression(expression, undefined, strategy),
          pointerVarTypes,
          knownFunctionReturnTypes,
        );

        if (snprintfRender) {
          const bufferName = `__typecode_println_${++scopeState.nextSnprintfTempId}`;
          const method = getConsoleMethod(statement.callee);
          const serialCall = strategy.transformConsoleCall(method, bufferName, false);
          emitSnprintfLines(bufferName, snprintfRender, {
            declareBuffer: true,
            finalLine: serialCall,
          });
          emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
          return;
        }
      }
    }

    // Handle typecode-call for serial println/print with snprintf for Arduino
    if (statement.kind === "typecode-call" && strategy.useSnprintfForStrings() && statement.args.length > 0) {
      const isSerialPrint = (statement.method === "println" || statement.method === "print") &&
        (statement.receiver === "UART0" || statement.receiver === "Serial" ||
         statement.receiver.startsWith("UART") || statement.receiver.startsWith("Serial"));
      
      if (isSerialPrint) {
        const firstArg = statement.args[0];
        if (firstArg.kind === "string_concat") {
          const snprintfRender = buildSnprintfRenderResult(
            firstArg,
            strategy,
            scopeState,
            (expression) => renderExpression(expression, undefined, strategy),
            pointerVarTypes,
            knownFunctionReturnTypes,
          );

          if (snprintfRender) {
            const bufferName = `__typecode_println_${++scopeState.nextSnprintfTempId}`;
            const serialInstance = statement.receiver.startsWith("UART")
              ? statement.receiver.slice(4) === "0" ? "Serial" : `Serial${statement.receiver.slice(4)}`
              : statement.receiver.startsWith("Serial")
                ? statement.receiver
                : "Serial";
            const serialMethod = statement.method;
            emitSnprintfLines(bufferName, snprintfRender, {
              declareBuffer: true,
              finalLine: `${serialInstance}.${serialMethod}(${bufferName});`,
            });
            emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
            return;
          }
        }
      }
    }

    if (statement.kind === "while") {
      const rendered = renderWithPrelude(statement, pointerVarTypes);
      for (const preludeLine of rendered.prelude) {
        appendSourceLine(`${indent}${preludeLine}`, {
          tsSpan: statement.sourceSpan,
          nodeKind: statement.kind,
        });
      }
      appendSourceLine(`${indent}${rendered.statement}`, {
        tsSpan: statement.sourceSpan,
        nodeKind: statement.kind,
      });
      appendSourceLine(`${indent}{`);
      const whileScope = cloneEmissionScopeState(scopeState);
      for (const nested of statement.body) {
        appendRenderedStatement(nested, `${indent}  `, pointerVarTypes, whileScope);
      }
      appendSourceLine(`${indent}}`);
      emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
      return;
    }

    if (statement.kind === "if") {
      const rendered = renderWithPrelude(statement);
      for (const preludeLine of rendered.prelude) {
        appendSourceLine(`${indent}${preludeLine}`, {
          tsSpan: statement.sourceSpan,
          nodeKind: statement.kind,
        });
      }
      appendSourceLine(`${indent}${rendered.statement}`, {
        tsSpan: statement.sourceSpan,
        nodeKind: statement.kind,
      });
      appendSourceLine(`${indent}{`);
      const thenScope = cloneEmissionScopeState(scopeState);
      for (const nested of statement.thenBranch) {
        appendRenderedStatement(nested, `${indent}  `, pointerVarTypes, thenScope);
      }
      appendSourceLine(`${indent}}`);

      if (statement.elseBranch && statement.elseBranch.length > 0) {
        appendSourceLine(`${indent}else {`);
        const elseScope = cloneEmissionScopeState(scopeState);
        for (const nested of statement.elseBranch) {
          appendRenderedStatement(nested, `${indent}  `, pointerVarTypes, elseScope);
        }
        appendSourceLine(`${indent}}`);
      }
      emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
      return;
    }

    if (statement.kind === "for") {
      const rendered = renderWithPrelude(statement);
      for (const preludeLine of rendered.prelude) {
        appendSourceLine(`${indent}${preludeLine}`, {
          tsSpan: statement.sourceSpan,
          nodeKind: statement.kind,
        });
      }
      appendSourceLine(`${indent}${rendered.statement}`, {
        tsSpan: statement.sourceSpan,
        nodeKind: statement.kind,
      });
      appendSourceLine(`${indent}{`);
      const forScope = cloneEmissionScopeState(scopeState);
      for (const nested of statement.body) {
        appendRenderedStatement(nested, `${indent}  `, pointerVarTypes, forScope);
      }
      appendSourceLine(`${indent}}`);
      emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
      return;
    }

    if (statement.kind === "for_of") {
      const rendered = renderWithPrelude(statement);
      for (const preludeLine of rendered.prelude) {
        appendSourceLine(`${indent}${preludeLine}`, {
          tsSpan: statement.sourceSpan,
          nodeKind: statement.kind,
        });
      }
      appendSourceLine(`${indent}${rendered.statement}`, {
        tsSpan: statement.sourceSpan,
        nodeKind: statement.kind,
      });
      appendSourceLine(`${indent}{`);
      const forOfScope = cloneEmissionScopeState(scopeState);
      for (const nested of statement.body) {
        appendRenderedStatement(nested, `${indent}  `, pointerVarTypes, forOfScope);
      }
      appendSourceLine(`${indent}}`);
      emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
      return;
    }

    if (statement.kind === "for_in") {
      const rendered = renderWithPrelude(statement);
      for (const preludeLine of rendered.prelude) {
        appendSourceLine(`${indent}${preludeLine}`, {
          tsSpan: statement.sourceSpan,
          nodeKind: statement.kind,
        });
      }
      appendSourceLine(`${indent}${rendered.statement}`, {
        tsSpan: statement.sourceSpan,
        nodeKind: statement.kind,
      });
      appendSourceLine(`${indent}{`);
      const forInScope = cloneEmissionScopeState(scopeState);
      for (const nested of statement.body) {
        appendRenderedStatement(nested, `${indent}  `, pointerVarTypes, forInScope);
      }
      appendSourceLine(`${indent}}`);
      emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
      return;
    }

    if (statement.kind === "do_while") {
      appendSourceLine(`${indent}do`, {
        tsSpan: statement.sourceSpan,
        nodeKind: statement.kind,
      });
      appendSourceLine(`${indent}{`);
      const doScope = cloneEmissionScopeState(scopeState);
      for (const nested of statement.body) {
        appendRenderedStatement(nested, `${indent}  `, pointerVarTypes, doScope);
      }
      appendSourceLine(`${indent}} while (${renderExpression(statement.condition, undefined, strategy)});`);
      emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
      return;
    }

    if (statement.kind === "switch") {
      const rendered = renderWithPrelude(statement);
      for (const preludeLine of rendered.prelude) {
        appendSourceLine(`${indent}${preludeLine}`, {
          tsSpan: statement.sourceSpan,
          nodeKind: statement.kind,
        });
      }
      appendSourceLine(`${indent}${rendered.statement}`, {
        tsSpan: statement.sourceSpan,
        nodeKind: statement.kind,
      });
      appendSourceLine(`${indent}{`);
      for (const caseClause of statement.cases) {
        emitCommentLines(caseClause.leadingComments, `${indent}  `, (line) => appendSourceLine(line));
        if (caseClause.value !== undefined) {
          appendSourceLine(`${indent}  case ${renderExpression(caseClause.value, undefined, strategy)}:`);
        } else {
          appendSourceLine(`${indent}  default:`);
        }
        const caseScope = cloneEmissionScopeState(scopeState);
        for (const nested of caseClause.body) {
          appendRenderedStatement(nested, `${indent}    `, pointerVarTypes, caseScope);
        }
        emitCommentLines(caseClause.trailingComments, `${indent}  `, (line) => appendSourceLine(line));
      }
      appendSourceLine(`${indent}}`);
      emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
      return;
    }

    if (statement.kind === "try") {
      const needsCatchAll = statement.finallyBlock && !statement.catchBlock;

      appendSourceLine(`${indent}try`, {
        tsSpan: statement.sourceSpan,
        nodeKind: statement.kind,
      });
      appendSourceLine(`${indent}{`);
      const tryScope = cloneEmissionScopeState(scopeState);
      for (const nested of statement.tryBlock) {
        appendRenderedStatement(nested, `${indent}  `, pointerVarTypes, tryScope);
      }
      appendSourceLine(`${indent}}`);

      if (statement.catchBlock) {
        const catchParam = statement.catchParam ?? "e";
        appendSourceLine(`${indent}catch (const std::exception& ${catchParam})`);
        appendSourceLine(`${indent}{`);
        const catchScope = cloneEmissionScopeState(scopeState);
        for (const nested of statement.catchBlock) {
          appendRenderedStatement(nested, `${indent}  `, pointerVarTypes, catchScope);
        }
        if (statement.finallyBlock) {
          const finallyScope = cloneEmissionScopeState(scopeState);
          for (const nested of statement.finallyBlock) {
            appendRenderedStatement(nested, `${indent}  `, pointerVarTypes, finallyScope);
          }
        }
        appendSourceLine(`${indent}}`);
      } else if (needsCatchAll) {
        appendSourceLine(`${indent}catch (...)`);
        appendSourceLine(`${indent}{`);
        if (statement.finallyBlock) {
          const finallyScope = cloneEmissionScopeState(scopeState);
          for (const nested of statement.finallyBlock) {
            appendRenderedStatement(nested, `${indent}  `, pointerVarTypes, finallyScope);
          }
        }
        appendSourceLine(`${indent}  throw;`);
        appendSourceLine(`${indent}}`);
        emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
        return;
      }

      emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
      return;
    }

    if (statement.kind === "throw") {
      const rendered = renderWithPrelude(statement);
      for (const preludeLine of rendered.prelude) {
        appendSourceLine(`${indent}${preludeLine}`, {
          tsSpan: statement.sourceSpan,
          nodeKind: statement.kind,
        });
      }
      appendSourceLine(`${indent}${rendered.statement}`, {
        tsSpan: statement.sourceSpan,
        nodeKind: statement.kind,
      });
      emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
      return;
    }

    if (statement.kind === "labeled") {
      appendSourceLine(`${indent}${statement.label}:`, {
        tsSpan: statement.sourceSpan,
        nodeKind: statement.kind,
      });
      appendSourceLine(`${indent}{`);
      const labeledScope = cloneEmissionScopeState(scopeState);
      for (const nested of statement.body) {
        appendRenderedStatement(nested, `${indent}  `, pointerVarTypes, labeledScope);
      }
      appendSourceLine(`${indent}}`);
      emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
      return;
    }

    if (statement.kind === "block") {
      appendSourceLine(`${indent}{`, {
        tsSpan: statement.sourceSpan,
        nodeKind: statement.kind,
      });
      const blockScope = cloneEmissionScopeState(scopeState);
      for (const nested of statement.body) {
        appendRenderedStatement(nested, `${indent}  `, pointerVarTypes, blockScope);
      }
      appendSourceLine(`${indent}}`);
      emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
      return;
    }

    const { prelude, statement: rendered } = renderWithPrelude(
      statement,
      pointerVarTypes,
      fixPointerFieldAccess,
    );

    for (const preludeLine of prelude) {
      appendSourceLine(`${indent}${preludeLine}`, {
        tsSpan: statement.sourceSpan,
        nodeKind: statement.kind,
      });
    }

    appendSourceLine(`${indent}${rendered}`, {
      tsSpan: statement.sourceSpan,
      nodeKind: statement.kind,
    });
    if (statement.kind === "var_decl") {
      recordVariableType(statement, scopeState);
    }
    emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
  }

  if (effectiveEmitMode === "split") {
    appendSourceLine(`#include \"${baseName}.h\"`);
  }

  if (effectiveEmitMode === "split" && program.classes.length > 0) {
    for (const classDef of program.classes) {
      appendHeaderLine(`class ${classDef.name};`);
    }
    appendHeaderLine("");
  }

  // Add iostream for generic C++ when console calls are used (use cached analysis)
  if (strategy.needsIostream() && programAnalysis.hasConsoleCalls) {
    includes.push("<iostream>");
  }

  // Use cached analysis results instead of multiple traversals
  const usesVectorTypes = programAnalysis.usesVectorTypes || programAnalysis.hasArrayInObjectLiteral;
  // For Arduino AVR, std::string is not available - skip the include
  if (programAnalysis.usesStdString && strategy.needsStdString()) {
    includes.push("<string>");
  }
  if (strategy.needsStdVector() && programAnalysis.usesVectorTypes) {
    includes.push("<vector>");
  }
  if (strategy.needsStdVector() && programAnalysis.hasArrayInObjectLiteral) {
    includes.push("<vector>");
  }
  if (programAnalysis.usesStdFunction) {
    includes.push("<functional>");
  }
  if (programAnalysis.hasThrowStatements && strategy.needsStdExcept()) {
    includes.push("<stdexcept>");
  }
  if (programAnalysis.hasStdMathCalls) {
    includes.push(strategy.mathHeader());
  }
  const needsSnprintf = strategy.useSnprintfForStrings() && (
    program.topLevelStatements.some((statement) => statementNeedsSnprintf(statement, strategy)) ||
    program.functions.some((fn) => fn.statements.some((statement) => statementNeedsSnprintf(statement, strategy))) ||
    program.classes.some((classDef) =>
      (classDef.constructor?.statements.some((statement) => statementNeedsSnprintf(statement, strategy)) ?? false) ||
      classDef.methods.some((method) => method.statements.some((statement) => statementNeedsSnprintf(statement, strategy)))
    )
  );
  if (needsSnprintf) {
    includes.push("<stdio.h>");
    includes.push("<stdlib.h>");
  }
  if (emittedPolyfills) {
    includes.push(...emittedPolyfills.includes.map((include) => normalizeInclude(include)));
  }

  for (const include of dedupe(includes)) {
    appendSourceLine(`#include ${include}`);
  }

  appendSourceLine("");

  const boilerplate = renderBoilerplate(program);
  if (boilerplate) {
    appendSourceLine(boilerplate.trimEnd());
    appendSourceLine("");
  }

  if (emittedPolyfills) {
    if (emittedPolyfills.declarations.length > 0) {
      for (const declaration of emittedPolyfills.declarations) {
        appendSourceLine(declaration);
      }
      appendSourceLine("");
    }

    if (emittedPolyfills.definitions.length > 0) {
      for (const definition of emittedPolyfills.definitions) {
        appendSourceLine(definition.trimEnd());
        appendSourceLine("");
      }
    }
  }

  // Emit async state-machine class + instance declarations (one per async function).
  // These must appear after the polyfill runtime (MicrotaskQueue, Promise) and
  // before setup()/loop() so that loop() can call taskVar.run().
  if (asyncTaskClasses.length > 0) {
    for (const { classDef, instanceDecl } of asyncTaskClasses) {
      for (const line of classDef.split("\n")) {
        appendSourceLine(line);
      }
      appendSourceLine("");
      appendSourceLine(instanceDecl);
      appendSourceLine("");
    }
  }

  if (strategy.needsVectorOverload() && hasConsoleCalls(program) && usesVectorTypes) {
    appendSourceLine("template <typename T>");
    appendSourceLine("std::ostream& operator<<(std::ostream& os, const std::vector<T>& values)");
    appendSourceLine("{");
    appendSourceLine("  os << \"[\";");
    appendSourceLine("  for (size_t i = 0; i < values.size(); ++i)");
    appendSourceLine("  {");
    appendSourceLine("    if (i > 0)");
    appendSourceLine("    {");
    appendSourceLine("      os << \", \";");
    appendSourceLine("    }");
    appendSourceLine("    os << values[i];");
    appendSourceLine("  }");
    appendSourceLine("  os << \"]\";");
    appendSourceLine("  return os;");
    appendSourceLine("}");
    appendSourceLine("");
  }

  if (shimLines.length > 0) {
    for (const line of shimLines) {
      appendSourceLine(line);
    }
    appendSourceLine("");
  }


  // Reserved names that conflict with macros/globals predefined by the target framework.
  // Provided by the platform strategy (e.g. Arduino defines HIGH, LOW, A0, etc.).
  const reservedNames = strategy.reservedNames();

  // Build set of compile-time (non-runtime) declared top-level variable names.
  // Used below when emitting struct initializers to zero-initialize forward-referenced
  // or suppressed runtime variables (like pin constants D0, D1, TX2 etc.).
  const compiletimeVarNames = new Set<string>(
    program.topLevelStatements
      .filter((stmt) => stmt.kind === "var_decl" && !statementRequiresRuntime(stmt))
      .map((stmt) => (stmt as { name: string }).name)
  );

  // Separate compile-time declarations from runtime statements
  // Compile-time declarations (literals, simple identifiers, static arrays) can go at global scope
  // Runtime statements (method calls, new expressions, etc.) must go in setup()/main()
  const topLevelDeclarations = program.topLevelStatements.filter(
    (item) => !statementRequiresRuntime(item)
  );
  // Filter out reserved names from the target platform
  const filteredTopLevelDeclarations = reservedNames.size > 0
    ? topLevelDeclarations.filter((item) => {
        if (item.kind === "var_decl") {
          return !reservedNames.has(item.name);
        }
        return true;
      })
    : topLevelDeclarations;
  const topLevelExecutables = program.topLevelStatements.filter(
    (item) => statementRequiresRuntime(item)
  );
  // Also suppress runtime var_decl statements whose names clash with
  // framework predefined symbols (e.g. A0, Serial).
  const filteredTopLevelExecutables_presuppress = reservedNames.size > 0
    ? topLevelExecutables.filter((item) => {
        if (item.kind === "var_decl") {
          return !reservedNames.has(item.name);
        }
        return true;
      })
    : topLevelExecutables;

  const entrypointFunctionName = strategy.entrypointFunctionName();
  const entrypointCallNames = new Set<string>([entrypointFunctionName]);
  for (const fn of program.functions) {
    if (mapFunctionName(fn.originalName, strategy) === entrypointFunctionName) {
      entrypointCallNames.add(fn.originalName);
      entrypointCallNames.add(applySymbolMap(fn.originalName, symbolMap));
    }
  }

  const filteredTopLevelExecutables = filteredTopLevelExecutables_presuppress.filter((statement) => {
    if (statement.kind !== "call") {
      return true;
    }

    const mappedCallee = applySymbolMap(statement.callee, symbolMap);
    // Filter out calls to entrypoint functions (setup/main) and async functions.
    // Async function calls are replaced by cooperative task instances driven in loop().
    if (!entrypointCallNames.has(statement.callee) && !entrypointCallNames.has(mappedCallee)) {
      return !asyncFunctionOriginalNames.has(statement.callee) && !asyncFunctionMappedNames.has(statement.callee);
    }
    return false;
  });

  const emittedTopLevelStatements = isEntryFile
    ? filteredTopLevelDeclarations
    : [
        ...filteredTopLevelDeclarations,
        ...filteredTopLevelExecutables.filter((statement) => statement.kind === "var_decl"),
      ];

  const knownTopLevelObjectTypes = new Map<string, string>();
  const knownTopLevelObjectFields = new Map<string, Map<string, string>>();

  // Collect pointer variable types from all executable statements
  const allExecutableStatements: StatementIR[] = [...filteredTopLevelExecutables];
  for (const fn of mappedFunctions) {
    allExecutableStatements.push(...fn.statements);
  }
  const globalPointerVarTypes = collectPointerVarTypes(allExecutableStatements, _arduinoClassNameMap);


  // Collect callback functions from call arguments (e.g., attachInterrupt handlers)
  const callbackFunctions: { name: string; params: string[]; statements: StatementIR[]; debounceMs?: number }[] = [];
  let callbackCounter = 0;
  
  function collectCallbacks(statements: StatementIR[]): void {
    for (const stmt of statements) {
      if (stmt.kind === "call" || stmt.kind === "typecode-call") {
        for (const arg of stmt.args) {
          if (arg.kind === "callback") {
            const callbackName = `isr_${callbackCounter++}`;
            callbackFunctions.push({
              name: callbackName,
              params: arg.params,
              statements: arg.statements,
              debounceMs: arg.debounceMs,
            });
            // Mutate the arg to replace with the callback name
            (arg as any).kind = "identifier";
            (arg as any).value = callbackName;
          }
        }
      }
      // Recurse into nested statements
      if ("body" in stmt && Array.isArray(stmt.body)) {
        collectCallbacks(stmt.body);
      }
      if ("thenBranch" in stmt && Array.isArray(stmt.thenBranch)) {
        collectCallbacks(stmt.thenBranch);
      }
      if ("elseBranch" in stmt && Array.isArray(stmt.elseBranch)) {
        collectCallbacks(stmt.elseBranch);
      }
      if ("cases" in stmt && Array.isArray(stmt.cases)) {
        for (const c of stmt.cases) {
          collectCallbacks(c.body);
        }
      }
    }
  }
  
  collectCallbacks(filteredTopLevelExecutables);
  for (const fn of mappedFunctions) {
    collectCallbacks(fn.statements);
  }

  // Collect struct field types that are pointers - needed for correct -> access
  const pointerStructFields = new Set<string>();
  for (const stmt of allExecutableStatements) {
    if (stmt.kind === "var_decl" && stmt.initializer?.kind === "object") {
      const structName = stmt.name;
      for (const field of stmt.initializer.fields) {
        const fieldType = inferObjectFieldType(field.value, globalPointerVarTypes, knownFunctionReturnTypes);
        if (fieldType.endsWith("*")) {
          pointerStructFields.add(`${structName}.${field.name}`);
        }
      }
    }
  }

  /**
   * Transform method calls on pointer variables and pointer struct fields from '.' to '->'
   * e.g., "sensor.readTemperature()" -> "sensor->readTemperature()" when sensor is a pointer
   * e.g., "Board.A0.read()" -> "Board.A0->read()" when A0 is a pointer field
   */
  function fixPointerFieldAccess(callee: string): string {
    // First, handle top-level pointer variables (e.g., sensor.method() -> sensor->method())
    for (const [varName, varType] of globalPointerVarTypes) {
      if (varType.endsWith("*")) {
        // Match patterns like "varName.method" and transform to "varName->method"
        const pattern = new RegExp(`\\b${varName}\\.`, "g");
        callee = callee.replace(pattern, `${varName}->`);
      }
    }
    
    // Then, handle pointer struct fields (e.g., Board.A0.method() -> Board.A0->method())
    for (const pointerField of pointerStructFields) {
      // Match patterns like "Board.A0.method" and transform to "Board.A0->method"
      const pattern = new RegExp(`(^|[^>])${pointerField.replace(".", "\\.")}\\.`, "g");
      callee = callee.replace(pattern, `$1${pointerField}->`);
    }
    return callee;
  }

  // Merge top-level executables into the entrypoint function
  if (isEntryFile && filteredTopLevelExecutables.length > 0) {
    const epName = entrypointFunctionName;  // "setup" or "main"
    const existingEp = mappedFunctions.find(fn => fn.name === epName);
    
    // Get platform-specific setup init code (e.g., UART initialization)
    // These are complete C++ statements, so we use a special marker to emit them as-is
    const setupInitLines = strategy.setupInitCode?.(program, options.platformContext) ?? [];
    const setupInitStmts: StatementIR[] = setupInitLines.map(line => ({
      kind: "call" as const,
      callee: `__RAW_STMT__${line}`,
      args: [],
      sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
    }));

    // Collect setup statements from polyfills (e.g., Serial.begin for console)
    const polyfillSetupLines: string[] = [];
    for (const polyfill of options.polyfills ?? []) {
      if (polyfill.setupStatements) {
        polyfillSetupLines.push(...polyfill.setupStatements);
      }
    }
    const polyfillSetupStmts: StatementIR[] = polyfillSetupLines.map(line => ({
      kind: "call" as const,
      callee: `__RAW_STMT__${line}`,
      args: [],
      sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
    }));

    // Combine platform setup init + polyfill setup statements
    const allSetupInitStmts = [...setupInitStmts, ...polyfillSetupStmts];
    
    if (existingEp) {
      existingEp.statements = [...allSetupInitStmts, ...filteredTopLevelExecutables, ...existingEp.statements];
    } else {
      // Arduino-style: void setup(); Generic: int main() with return 0
      const isMain = epName === "main";
      const returnType = isMain ? "int" : "void";
      const stmts: StatementIR[] = isMain
        ? [...allSetupInitStmts, ...filteredTopLevelExecutables, { kind: "return" as const, sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 }, value: { kind: "number" as const, value: 0 } } as StatementIR]
        : [...allSetupInitStmts, ...filteredTopLevelExecutables];
      const insertFn = {
        name: epName,
        returnType,
        sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
        leadingComments: [`// Auto-generated ${epName}() for top-level statements`],
        trailingComments: undefined,
        parameters: [],
        isAsync: false,
        statements: stmts,
      };
      if (isMain) {
        mappedFunctions.push(insertFn);
      } else {
        mappedFunctions.unshift(insertFn);
      }
    }
  }

  // Ensure the entrypoint function (setup/main) exists even when all top-level
  // executables were filtered out (e.g., only async function calls remain which
  // are replaced by cooperative task instances driven in loop()).
  if (isEntryFile && !mappedFunctions.some((fn) => fn.name === entrypointFunctionName)) {
    const isMain = entrypointFunctionName === "main";
    const returnType = isMain ? "int" : "void";
    const stmts: StatementIR[] = isMain
      ? [{ kind: "return" as const, sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 }, value: { kind: "number" as const, value: 0 } } as StatementIR]
      : [];
    const insertFn = {
      name: entrypointFunctionName,
      returnType,
      sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
      leadingComments: undefined,
      trailingComments: undefined,
      parameters: [],
      isAsync: false,
      statements: stmts,
    };
    if (isMain) {
      mappedFunctions.push(insertFn);
    } else {
      mappedFunctions.unshift(insertFn);
    }
  }

  // Some platforms require a loop/main-loop function even if empty
  if (isEntryFile && strategy.requiresLoopFunction() && !mappedFunctions.some((fn) => fn.name === "loop")) {
    mappedFunctions.push({
      name: "loop",
      returnType: "void",
      sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
      leadingComments: hasAsyncRuntime ? ["// Auto-generated loop() for async microtask pumping"] : undefined,
      trailingComments: undefined,
      parameters: [],
      isAsync: false,
      statements: [],
    });
  }

  // Only generate main() for entry files when there's no loop-based strategy
  if (isEntryFile && hasAsyncRuntime && !strategy.requiresLoopFunction() && !mappedFunctions.some((fn) => fn.name === "main")) {
    mappedFunctions.push({
      name: "main",
      returnType: "int",
      sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
      leadingComments: ["// Auto-generated main() for async microtask pumping"],
      trailingComments: undefined,
      parameters: [],
      isAsync: false,
      statements: [{ kind: "return", sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 }, value: { kind: "number", value: 0 } }],
    });
  }

  // Enum class names that are already declared as C typedefs in the target API.
  // Guard them with a preprocessor conditional so they are only emitted when needed.
  const apiReservedEnums = strategy.apiReservedEnumNames();

  // Emit register-mapped structs (volatile pointers to MMIO addresses)
  for (const reg of program.registerClasses ?? []) {
    const addrHex = '0x' + reg.address.toString(16).toUpperCase().replace(/^0X/, '');
    emitCommentLines(reg.leadingComments, "", (line) => appendSourceLine(line));
    appendSourceLine(`volatile uint32_t* const ${reg.name} = reinterpret_cast<volatile uint32_t*>(${addrHex});`);
    emitCommentLines(reg.trailingComments, "", (line) => appendSourceLine(line));
  }
  if ((program.registerClasses?.length ?? 0) > 0) {
    appendSourceLine("");
  }

  // Emit enums
  for (const enumDef of program.enums) {
    const appendLine = effectiveEmitMode === "split" ? appendHeaderLine : appendSourceLine;
    emitCommentLines(enumDef.leadingComments, "", (line) => appendLine(line));
    const enumKeyword = enumDef.isConst ? "enum class" : "enum class";
    // Add an explicit underlying type for enums that contain values outside the
    // platform's default int range (e.g. AVR int is 16-bit).
    const needsLongUnderlying = strategy.needsLargeEnumUnderlying() &&
      enumDef.members.some(m => m.value !== undefined && (m.value > 32767 || m.value < -32768));
    const underlyingType = needsLongUnderlying ? " : long" : "";
    // Guard enum classes that conflict with target API typedef declarations.
    const needsApiGuard = apiReservedEnums.has(enumDef.name);
    if (needsApiGuard) {
      appendLine(`#if !defined(ARDUINO_API_VERSION)`);
    }
    appendLine(`${enumKeyword} ${enumDef.name}${underlyingType} {`);
    for (let i = 0; i < enumDef.members.length; i++) {
      const member = enumDef.members[i];
      const valueSuffix = member.value !== undefined ? ` = ${member.value}` : "";
      const commaSuffix = i < enumDef.members.length - 1 ? "," : "";
      // Prefix reserved names with underscore for Arduino compatibility
      // Prefix reserved names for platform compatibility
      const memberName = reservedNames.has(member.name) 
        ? `_${member.name}` 
        : member.name;
      appendLine(`  ${memberName}${valueSuffix}${commaSuffix}`);
    }
    appendLine("};");
    if (needsApiGuard) {
      appendLine(`#endif // !defined(ARDUINO_API_VERSION)`);
    }
    emitCommentLines(enumDef.trailingComments, "", (line) => appendLine(line));
    appendLine("");
  }

  // Emit type aliases
  for (const typeAlias of program.typeAliases) {
    const appendLine = effectiveEmitMode === "split" ? appendHeaderLine : appendSourceLine;
    emitCommentLines(typeAlias.leadingComments, "", (line) => appendLine(line));
    // Skip type aliases with 'auto' as it's not valid in C++ type aliases
    // Also skip for Arduino if the type uses std::string (not available on AVR)
    const cppType = normalizeCppTypeForTarget(typeAlias.cppType, strategy);
    if (cppType === "auto") {
      continue; // Skip invalid 'auto' type aliases
    }
    if (strategy.shouldSkipTypeAlias(cppType)) {
      continue; // Strategy decided to skip this type alias
    }
    appendLine(`using ${typeAlias.name} = ${cppType};`);
    emitCommentLines(typeAlias.trailingComments, "", (line) => appendLine(line));
    appendLine("");
  }

  // Emit top-level constant declarations BEFORE classes so that constants
  // used in class constructor default parameters are defined first.
  // ONLY emit compile-time declarations here (literals, simple identifiers).
  // Runtime declarations (new expressions, function calls) must go AFTER classes.
  const topLevelScope = createEmissionScopeState();
  for (const statement of emittedTopLevelStatements) {
    if (statement.kind === "var_decl" && statement.initializer?.kind === "object") {
      continue;
    }
    if (statement.kind === "var_decl" && statement.initializer && isRuntimeExpression(statement.initializer)) {
      continue;
    }
    appendRenderedStatement(statement, "", globalPointerVarTypes, topLevelScope);
  }
  if (emittedTopLevelStatements.some(s =>
    s.kind === "var_decl" &&
    s.initializer?.kind !== "object" &&
    !(s.initializer && isRuntimeExpression(s.initializer))
  )) {
    appendSourceLine("");
  }


  // Emit namespaces
  for (const ns of program.namespaces) {
    emitCommentLines(ns.leadingComments, "", (line) => appendSourceLine(line));
    appendSourceLine(`namespace ${ns.name} {`);
    appendSourceLine("");
    
    // Emit namespace enums
    for (const enumDef of ns.enums) {
      emitCommentLines(enumDef.leadingComments, "  ", (line) => appendSourceLine(line));
      const enumKeyword = enumDef.isConst ? "enum class" : "enum class";
      const needsLongUnderlying = strategy.needsLargeEnumUnderlying() &&
        enumDef.members.some(m => m.value !== undefined && (m.value > 32767 || m.value < -32768));
      const underlyingType = needsLongUnderlying ? " : long" : "";
      appendSourceLine(`  ${enumKeyword} ${enumDef.name}${underlyingType} {`);
      for (let i = 0; i < enumDef.members.length; i++) {
        const member = enumDef.members[i];
        const valueSuffix = member.value !== undefined ? ` = ${member.value}` : "";
        const commaSuffix = i < enumDef.members.length - 1 ? "," : "";
        appendSourceLine(`    ${member.name}${valueSuffix}${commaSuffix}`);
      }
      appendSourceLine("  };");
      emitCommentLines(enumDef.trailingComments, "  ", (line) => appendSourceLine(line));
      appendSourceLine("");
    }
    
    // Emit namespace type aliases
    for (const typeAlias of ns.typeAliases) {
      emitCommentLines(typeAlias.leadingComments, "  ", (line) => appendSourceLine(line));
      const cppType = normalizeCppTypeForTarget(typeAlias.cppType, strategy);
      if (cppType !== "auto" && !strategy.shouldSkipTypeAlias(cppType)) {
        appendSourceLine(`  using ${typeAlias.name} = ${cppType};`);
        emitCommentLines(typeAlias.trailingComments, "  ", (line) => appendSourceLine(line));
        appendSourceLine("");
      }
    }
    
    // Emit namespace constants
    for (const constant of ns.constants) {
      const constType = normalizeCppTypeForTarget(constant.cppType, strategy);
      if (constType !== "auto") {
        appendSourceLine(`  const ${constType} ${constant.name} = ${renderExpression(constant.value, undefined, strategy)};`);
      } else {
        appendSourceLine(`  const auto ${constant.name} = ${renderExpression(constant.value, undefined, strategy)};`);
      }
    }
    if (ns.constants.length > 0) {
      appendSourceLine("");
    }
    
    // Emit namespace classes
    for (const classDef of ns.classes) {
      emitCommentLines(classDef.leadingComments, "  ", (line) => appendSourceLine(line));
      
      if (classDef.isAbstract) {
        appendSourceLine(`  // Abstract class - contains pure virtual methods`);
      }
      
      appendSourceLine(`  class ${classDef.name} {`);
      
      // Group fields and methods by visibility
      const publicFields = classDef.fields.filter(f => f.visibility === "public");
      const privateFields = classDef.fields.filter(f => f.visibility === "private");
      const protectedFields = classDef.fields.filter(f => f.visibility === "protected");
      const publicMethods = classDef.methods.filter(m => m.visibility === "public");
      const privateMethods = classDef.methods.filter(m => m.visibility === "private");
      const protectedMethods = classDef.methods.filter(m => m.visibility === "protected");
      
      // Public section
      if (publicFields.length > 0 || publicMethods.length > 0 || classDef.constructor) {
        appendSourceLine("  public:");
        
        if (classDef.constructor) {
          const ctorParams = renderParameters(classDef.constructor.parameters, strategy);
          appendSourceLine(`    ${classDef.name}(${ctorParams}) {`);
          const ctorScope = createChildEmissionScope(topLevelScope, classDef.constructor.parameters);
          for (const stmt of classDef.constructor.statements) {
            appendRenderedStatement(stmt, "      ", undefined, ctorScope);
          }
          appendSourceLine("    }");
          appendSourceLine("");
        }
        
        for (const field of publicFields) {
          const initSuffix = field.initializer ? ` = ${renderExpression(field.initializer, undefined, strategy)}` : "";
          const fieldType = strategy.overrideClassFieldType(field.name, normalizeCppTypeForTarget(field.cppType, strategy));
          appendSourceLine(`    ${renderTypedName(fieldType, field.name, strategy)}${initSuffix};`);
        }
        if (publicFields.length > 0) {
          appendSourceLine("");
        }
        
        for (const method of publicMethods) {
          const methodParams = renderParameters(method.parameters, strategy);
          const staticPrefix = method.isStatic ? "static " : "";
          const returnType = normalizeCppTypeForTarget(method.returnType, strategy);
          
          if (method.isAbstract) {
            appendSourceLine(`    virtual ${returnType} ${method.name}(${methodParams}) = 0;`);
            appendSourceLine("");
            continue;
          }
          
          appendSourceLine(`    ${staticPrefix}${returnType} ${method.name}(${methodParams}) {`);
          const methodScope = createChildEmissionScope(topLevelScope, method.parameters);
          for (const stmt of method.statements) {
            appendRenderedStatement(stmt, "      ", undefined, methodScope);
          }
          appendSourceLine("    }");
          appendSourceLine("");
        }
      }
      
      // Private section
      if (privateFields.length > 0 || privateMethods.length > 0) {
        appendSourceLine("  private:");
        for (const field of privateFields) {
          const initSuffix = field.initializer ? ` = ${renderExpression(field.initializer, undefined, strategy)}` : "";
          const fieldType = strategy.overrideClassFieldType(field.name, normalizeCppTypeForTarget(field.cppType, strategy));
          appendSourceLine(`    ${renderTypedName(fieldType, field.name, strategy)}${initSuffix};`);
        }
        for (const method of privateMethods) {
          const methodParams = renderParameters(method.parameters, strategy);
          appendSourceLine(`    ${normalizeCppTypeForTarget(method.returnType, strategy)} ${method.name}(${methodParams}) {`);
          const methodScope = createChildEmissionScope(topLevelScope, method.parameters);
          for (const stmt of method.statements) {
            appendRenderedStatement(stmt, "      ", undefined, methodScope);
          }
          appendSourceLine("    }");
        }
      }
      
      // Protected section
      if (protectedFields.length > 0 || protectedMethods.length > 0) {
        appendSourceLine("  protected:");
        for (const field of protectedFields) {
          const initSuffix = field.initializer ? ` = ${renderExpression(field.initializer, undefined, strategy)}` : "";
          const fieldType = strategy.overrideClassFieldType(field.name, normalizeCppTypeForTarget(field.cppType, strategy));
          appendSourceLine(`    ${renderTypedName(fieldType, field.name, strategy)}${initSuffix};`);
        }
        for (const method of protectedMethods) {
          const methodParams = renderParameters(method.parameters, strategy);
          appendSourceLine(`    ${normalizeCppTypeForTarget(method.returnType, strategy)} ${method.name}(${methodParams}) {`);
          const methodScope = createChildEmissionScope(topLevelScope, method.parameters);
          for (const stmt of method.statements) {
            appendRenderedStatement(stmt, "      ", undefined, methodScope);
          }
          appendSourceLine("    }");
        }
      }
      
      appendSourceLine("  };");
      emitCommentLines(classDef.trailingComments, "  ", (line) => appendSourceLine(line));
      appendSourceLine("");
    }
    
    // Emit namespace functions
    for (const fn of ns.functions) {
      const parameterList = renderParameters(fn.parameters, strategy);
      emitCommentLines(fn.leadingComments, "  ", (line) => appendSourceLine(line));
      appendSourceLine(`  ${normalizeCppTypeForTarget(fn.returnType, strategy)} ${fn.originalName}(${parameterList}) {`);
      const namespaceFunctionScope = createChildEmissionScope(topLevelScope, fn.parameters);
      for (const statement of fn.statements) {
        appendRenderedStatement(statement, "    ", undefined, namespaceFunctionScope);
      }
      appendSourceLine("  }");
      emitCommentLines(fn.trailingComments, "  ", (line) => appendSourceLine(line));
      appendSourceLine("");
    }
    
    appendSourceLine("} // namespace ${ns.name}");
    emitCommentLines(ns.trailingComments, "", (line) => appendSourceLine(line));
    appendSourceLine("");
  }

  // Emit classes
  for (const classDef of program.classes) {
    emitCommentLines(classDef.leadingComments, "", (line) => appendSourceLine(line));
    
    // Build inheritance clause: extends + implements
    const inheritanceParts: string[] = [];
    if (classDef.extendsClass) {
      inheritanceParts.push(`public ${classDef.extendsClass}`);
    }
    if (classDef.implementsInterfaces && classDef.implementsInterfaces.length > 0) {
      // In C++, interfaces are just classes - use public inheritance
      for (const iface of classDef.implementsInterfaces) {
        inheritanceParts.push(`public ${iface}`);
      }
    }
    const inheritanceClause = inheritanceParts.length > 0 ? ` : ${inheritanceParts.join(", ")}` : "";
    
    // Abstract classes get a comment (C++ doesn't have abstract keyword, uses pure virtual methods)
    if (classDef.isAbstract) {
      appendSourceLine(`// Abstract class - contains pure virtual methods`);
    }
    
    appendSourceLine(`class ${classDef.name}${inheritanceClause} {`);
    
    // Group fields by visibility
    const publicFields = classDef.fields.filter(f => f.visibility === "public");
    const privateFields = classDef.fields.filter(f => f.visibility === "private");
    const protectedFields = classDef.fields.filter(f => f.visibility === "protected");
    
    const publicMethods = classDef.methods.filter(m => m.visibility === "public");
    const privateMethods = classDef.methods.filter(m => m.visibility === "private");
    const protectedMethods = classDef.methods.filter(m => m.visibility === "protected");
    
    // Emit public section
    if (publicFields.length > 0 || publicMethods.length > 0 || classDef.constructor) {
      appendSourceLine("public:");
      
      // Constructor
      if (classDef.constructor) {
        // Normalize constructor parameter types via strategy
        const ctorParamsMapped = classDef.constructor.parameters.map(p => ({
          ...p,
          cppType: normalizeCppTypeForTarget(p.cppType, strategy)
        }));
        const ctorParams = renderParameters(ctorParamsMapped, strategy);
        let ctorInitializer = "";
        let ctorStatements = classDef.constructor.statements;
        const firstCtorStatement = ctorStatements[0];
        if (classDef.extendsClass && firstCtorStatement && firstCtorStatement.kind === "call" && firstCtorStatement.callee === "super") {
          const baseArgs = firstCtorStatement.args.map((arg) => renderExpression(arg, fixPointerFieldAccess, strategy)).join(", ");
          ctorInitializer = ` : ${classDef.extendsClass}(${baseArgs})`;
          ctorStatements = ctorStatements.slice(1);
        }

        appendSourceLine(`  ${classDef.name}(${ctorParams})${ctorInitializer} {`);
        const ctorScope = createChildEmissionScope(topLevelScope, classDef.constructor.parameters);
        for (const stmt of ctorStatements) {
          appendRenderedStatement(stmt, "    ", undefined, ctorScope);
        }
        appendSourceLine("  }");
        appendSourceLine("");
      }
      
      // Public fields
      for (const field of publicFields) {
        const initSuffix = field.initializer ? ` = ${renderExpression(field.initializer, undefined, strategy)}` : "";
        const fieldType = strategy.overrideClassFieldType(field.name, normalizeCppTypeForTarget(field.cppType, strategy));
        appendSourceLine(`  ${renderTypedName(fieldType, field.name, strategy)}${initSuffix};`);
      }
      if (publicFields.length > 0) {
        appendSourceLine("");
      }
      
      // Public methods
      for (const method of publicMethods) {
        const methodParams = renderParameters(method.parameters, strategy);
        const staticPrefix = method.isStatic ? "static " : "";
        const returnType = normalizeCppTypeForTarget(method.returnType, strategy);
        
        // Handle abstract methods (pure virtual in C++)
        if (method.isAbstract) {
          appendSourceLine(`  virtual ${returnType} ${method.name}(${methodParams}) = 0;`);
          appendSourceLine("");
          continue;
        }
        
        appendSourceLine(`  ${staticPrefix}${returnType} ${method.name}(${methodParams}) {`);
        const methodScope = createChildEmissionScope(topLevelScope, method.parameters);
        for (const stmt of method.statements) {
          appendRenderedStatement(stmt, "    ", undefined, methodScope);
        }
        appendSourceLine("  }");
        appendSourceLine("");
      }
    }
    
    // Emit private section
    if (privateFields.length > 0 || privateMethods.length > 0) {
      appendSourceLine("private:");
      for (const field of privateFields) {
        const initSuffix = field.initializer ? ` = ${renderExpression(field.initializer, undefined, strategy)}` : "";
        const fieldType = strategy.overrideClassFieldType(field.name, normalizeCppTypeForTarget(field.cppType, strategy));
        appendSourceLine(`  ${renderTypedName(fieldType, field.name, strategy)}${initSuffix};`);
      }
      if (privateFields.length > 0) {
        appendSourceLine("");
      }
      for (const method of privateMethods) {
        const methodParams = renderParameters(method.parameters, strategy);
        const staticPrefix = method.isStatic ? "static " : "";
        appendSourceLine(`  ${staticPrefix}${normalizeCppTypeForTarget(method.returnType, strategy)} ${method.name}(${methodParams}) {`);
        const methodScope = createChildEmissionScope(topLevelScope, method.parameters);
        for (const stmt of method.statements) {
          appendRenderedStatement(stmt, "    ", undefined, methodScope);
        }
        appendSourceLine("  }");
        appendSourceLine("");
      }
    }
    
    // Emit protected section
    if (protectedFields.length > 0 || protectedMethods.length > 0) {
      appendSourceLine("protected:");
      for (const field of protectedFields) {
        const initSuffix = field.initializer ? ` = ${renderExpression(field.initializer, undefined, strategy)}` : "";
        const fieldType = strategy.overrideClassFieldType(field.name, normalizeCppTypeForTarget(field.cppType, strategy));
        appendSourceLine(`  ${renderTypedName(fieldType, field.name, strategy)}${initSuffix};`);
      }
      if (protectedFields.length > 0) {
        appendSourceLine("");
      }
      for (const method of protectedMethods) {
        const methodParams = renderParameters(method.parameters, strategy);
        const staticPrefix = method.isStatic ? "static " : "";
        appendSourceLine(`  ${staticPrefix}${normalizeCppTypeForTarget(method.returnType, strategy)} ${method.name}(${methodParams}) {`);
        const methodScope = createChildEmissionScope(topLevelScope, method.parameters);
        for (const stmt of method.statements) {
          appendRenderedStatement(stmt, "    ", undefined, methodScope);
        }
        appendSourceLine("  }");
        appendSourceLine("");
      }
    }
    
    appendSourceLine("};");
    emitCommentLines(classDef.trailingComments, "", (line) => appendSourceLine(line));
    appendSourceLine("");
  }


  // Emit runtime variable declarations AFTER classes (for non-entry files)
  // These are variables that use 'new' or function calls and need the class defined first
  // For entry files, these go into setup() instead
  if (!isEntryFile) {
    const runtimeTopLevelScope = cloneEmissionScopeState(topLevelScope);
    for (const statement of emittedTopLevelStatements) {
      if (statement.kind === "var_decl" && statement.initializer && isRuntimeExpression(statement.initializer)) {
        appendRenderedStatement(statement, "", globalPointerVarTypes, runtimeTopLevelScope);
      }
    }
  }

  // Emit object literal struct definitions (after classes so they can reference class types)
  // These were skipped in the earlier pass, so emit only object literals here
  for (const statement of emittedTopLevelStatements) {
    if (
      effectiveEmitMode === "split" &&
      statement.kind === "var_decl" &&
      statement.initializer?.kind === "object"
    ) {
      const structName = `_${statement.name}_t`;
      const fieldTypeEntries = statement.initializer.fields.map((field) => {
        const inferred = inferObjectFieldType(
          field.value,
          globalPointerVarTypes,
          knownFunctionReturnTypes,
          knownTopLevelObjectTypes,
          knownTopLevelObjectFields,
        );
        return [field.name, inferred] as const;
      });
      const fieldDefs = fieldTypeEntries
        .map(([fieldName, inferredType]) => {
          // Rename struct fields that match Arduino reserved macro/global names to avoid
          // preprocessor expansion inside struct definitions (e.g. TX2 → (gpio_num_t)25).
          const safeFieldName = strategy.renameStructField(fieldName);
          return `${inferredType} ${safeFieldName};`;
        })
        .join(" ");
      const initValues = statement.initializer.fields
        .map((field) => {
          const renderExpr = (e: ExpressionIR) => renderExpression(e, fixPointerFieldAccess, strategy);
          const overridden = strategy.objectFieldInitializer(field.value, renderExpr);
          if (overridden !== undefined) return overridden;
          // Zero-initialize identifier references to non-compile-time variables
          // when they may be forward-referenced or suppressed by the platform.
          const structInit = strategy.structFieldInitializer(field.value, compiletimeVarNames, renderExpr);
          if (structInit !== undefined) return structInit;
          return renderExpression(field.value, fixPointerFieldAccess, strategy);
        })
        .join(", ");

      knownTopLevelObjectTypes.set(statement.name, structName);
      knownTopLevelObjectFields.set(statement.name, new Map(fieldTypeEntries));

      emitCommentLines(statement.leadingComments, "", (line) => appendHeaderLine(line));
      appendHeaderLine(`struct ${structName} { ${fieldDefs} };`);
      appendHeaderLine(`extern ${structName} ${statement.name};`);
      emitCommentLines(statement.trailingComments, "", (line) => appendHeaderLine(line));

      emitCommentLines(statement.leadingComments, "", (line) => appendSourceLine(line));
      appendSourceLine(`${structName} ${statement.name} = { ${initValues} };`, {
        tsSpan: statement.sourceSpan,
        nodeKind: statement.kind,
      });
      emitCommentLines(statement.trailingComments, "", (line) => appendSourceLine(line));
    }
  }
  if (emittedTopLevelStatements.some(s => s.kind === "var_decl" && (s as any).initializer?.kind === "object")) {
    appendSourceLine("");
  }

  // Emit callback functions (e.g., interrupt handlers) before regular functions
  for (const callback of callbackFunctions) {
    // If debounce is configured, emit debounce wrapper
    if (callback.debounceMs !== undefined && callback.debounceMs > 0) {
      // Declare static variables for debounce timing
      appendSourceLine(`volatile unsigned long ${callback.name}_lastTime = 0;`);
      appendSourceLine(`const unsigned long ${callback.name}_debounce = ${callback.debounceMs};`);
      appendSourceLine("");
    }
    
    appendSourceLine(`void ${callback.name}() {`);
    
    // Add debounce check if configured
    if (callback.debounceMs !== undefined && callback.debounceMs > 0) {
      appendSourceLine(`  volatile unsigned long now = millis();`);
      appendSourceLine(`  if (now - ${callback.name}_lastTime < ${callback.name}_debounce) return;`);
      appendSourceLine(`  ${callback.name}_lastTime = now;`);
    }
    
    const callbackScope = createChildEmissionScope(topLevelScope);
    for (const stmt of callback.statements) {
      appendRenderedStatement(stmt, "  ", globalPointerVarTypes, callbackScope);
    }
    appendSourceLine("}");
    appendSourceLine("");
  }

  for (const fn of mappedFunctions) {
    const parameterList = renderParameters(fn.parameters, strategy);
    if (effectiveEmitMode === "split") {
      emitCommentLines(fn.leadingComments, "", (line) => appendHeaderLine(line));
      appendHeaderLine(`${normalizeCppTypeForTarget(fn.returnType, strategy)} ${fn.name}(${parameterList});`, {
        tsSpan: fn.sourceSpan,
        nodeKind: "function_declaration",
        symbolName: fn.name,
      });
      emitCommentLines(fn.trailingComments, "", (line) => appendHeaderLine(line));
    }

    emitCommentLines(fn.leadingComments, "", (line) => appendSourceLine(line));
    appendSourceLine(`${normalizeCppTypeForTarget(fn.returnType, strategy)} ${fn.name}(${parameterList})`, {
      tsSpan: fn.sourceSpan,
      nodeKind: "function_definition",
      symbolName: fn.name,
    });
    appendSourceLine("{");
    // Inject microtask pumping into the async driver function
    const asyncDriverFn = strategy.asyncDriverFunctionName();
    if (hasPromiseRuntime && fn.name === asyncDriverFn) {
      appendSourceLine("  typecode_pump_microtasks();");
    }
    // Async tasks are driven by their state machine; don't emit the blocking body.
    if (fn.isAsync && hasAsyncRuntime) {
      appendSourceLine(`  // driven as cooperative task in ${asyncDriverFn}()`);
    } else {
      const functionScope = createChildEmissionScope(topLevelScope, fn.parameters);
      for (const statement of fn.statements) {
        appendRenderedStatement(statement, "  ", globalPointerVarTypes, functionScope);
      }
    }
    if (hasAsyncRuntime && fn.name === asyncDriverFn) {
      // Drive all async state machines
      const taskNames = asyncTaskClasses.map(t => t.taskVarName);
      const injectionLines = strategy.asyncLoopInjection(taskNames, hasPromiseRuntime);
      for (const line of injectionLines) {
        appendSourceLine(`  ${line}`);
      }
    }
    appendSourceLine("}");
    emitCommentLines(fn.trailingComments, "", (line) => appendSourceLine(line));
    appendSourceLine("");
  }

  let outputHeaderPath: string | undefined;
  let outputHeaderMapPath: string | undefined;
  if (effectiveEmitMode === "split") {
    // Add re-export includes to the header
    const finalHeaderLines = [...headerLines];
    const headerIncludeLines = dedupe([
      ...includes,
      ...headerIncludes,
    ]);
    if (headerIncludeLines.length > 0) {
      // Insert includes after #pragma once
      const includeLines = headerIncludeLines.map((inc) => `#include ${inc}`);
      finalHeaderLines.splice(1, 0, ...includeLines, "");
    }

    // Emit forward declarations for cross-module class types.
    // When a file references a class defined in another transpiled module
    // (e.g., as a pointer or parameter type), the compiler needs a forward
    // declaration if the header hasn't been included yet.
    if (options.crossModuleClasses && options.crossModuleClasses.size > 0) {
      // Collect class names defined in THIS file (no need to forward-declare own classes)
      const localClasses = new Set(program.classes.map(cls => cls.name));
      // Collect imported symbols that refer to cross-module classes
      const importedSymbols = new Set<string>();
      for (const imp of program.imports) {
        for (const sym of imp.namedImports) {
          importedSymbols.add(sym);
        }
      }
      const forwardDecls: string[] = [];
      for (const className of options.crossModuleClasses) {
        if (!localClasses.has(className) && importedSymbols.has(className)) {
          forwardDecls.push(`class ${className};`);
        }
      }
      if (forwardDecls.length > 0) {
        // Find the insertion point: after #pragma once, blank line, and includes
        // The header starts with "#pragma once" at index 0, then includes were
        // spliced in at index 1. Find the first non-include, non-blank line after includes.
        let insertIdx = 1;
        // Skip past any inserted include lines
        while (insertIdx < finalHeaderLines.length &&
               (finalHeaderLines[insertIdx].startsWith("#include") ||
                finalHeaderLines[insertIdx] === "")) {
          insertIdx++;
        }
        // Insert forward declarations with a blank line separator
        finalHeaderLines.splice(insertIdx, 0, ...forwardDecls, "");
      }
    }

    writeText(headerPath, finalHeaderLines.join("\n").trimEnd() + "\n");
    outputHeaderPath = headerPath;
    if (options.emitMaps) {
      outputHeaderMapPath = writeSourceMap(makeGeneratedMap(headerPath, program.fileName, headerMapEntries));
    }
  }

  writeText(sourcePath, sourceLines.join("\n").trimEnd() + "\n");
  const outputSourceMapPath = options.emitMaps
    ? writeSourceMap(makeGeneratedMap(sourcePath, program.fileName, sourceMapEntries))
    : undefined;

  const diagnostics: Diagnostic[] = [...program.diagnostics, ...profileDiagnostics];
  // Delegate any strategy-specific diagnostics (e.g. Arduino split-mode warning)
  diagnostics.push(...strategy.emitDiagnostics(options.emitMode));
  return {
    headerPath: outputHeaderPath,
    sourcePath,
    headerMapPath: outputHeaderMapPath,
    sourceMapPath: outputSourceMapPath,
    diagnostics,
  };
}
