import path from "node:path";
import { ProgramIR, ExpressionIR, StatementIR } from "../ir/model";
import { analyzeProgram, ProgramAnalysisResult } from "../ir/program-analysis";
import { Diagnostic, EmitMode, GeneratedOutputs, PlatformContext, SourceMapEntry, TargetProfile } from "../types";
import { ensureDir, writeText } from "../utils/fs";
import { escapeCppKeyword } from "../utils/strings";
import { resolveImport } from "../libdef/registry";
import { LibraryDefinition } from "../types";
import { makeGeneratedMap, writeSourceMap } from "../mapping/source-map";
import { RuntimePolyfillIR } from "@typehal/core/shared";
import { emitPolyfillBoilerplate } from "./native-helpers-emitter";
import { filterPolyfillHelpers } from "@typehal/core/shared";
import { ResolvedNpmPackage } from "../transpile/resolution";
import { extractPropertyChain } from "../ir/extract-property-chain";
import type { BoardConstants } from "../ir/board-resolver";
import type { PlatformStrategy } from "../platform/platform-strategy";
import { resolveStrategy } from "../platform/registry";
import { getLoadedFramework } from "../framework-registry";
import { buildSnprintfRenderResult, cloneEmissionScopeState, createChildEmissionScope, createEmissionScopeState, type EmissionScopeState, inferSnprintfArg, recordVariableType, statementNeedsSnprintf, shouldUseSnprintfForString } from "./snprintf-helpers";
import { normalizeRawExpression, transformTypeName } from "./expression-renderer";
import { mapPeripheralName, renderPeripheralProperty } from "../mapping/peripheral-names";
import { accessorGetterName, accessorSetterName } from "./utils/cpp-helpers";
import { StatementRenderer } from "./statement-renderer";
import {
  isTypehalSDKImport,
  emitCommentLines,
  isConsoleCall,
  getConsoleMethod,
  normalizeInclude,
  dedupe,
  applySymbolMap,
  resolveTranspiledModuleInclude,
  generateAsyncTaskClass,
  inferObjectFieldType,
  collectNestedStructDefs,
  isRuntimeExpression,
  statementRequiresRuntime,
  collectPointerVarTypes,
  hasConsoleCalls,
} from "./utils";

// ---------------------------------------------------------------------------
// Pre-compiled regex patterns for performance
// ---------------------------------------------------------------------------
const PATH_BACKSLASH_PATTERN = /\\/g;
const DOUBLE_QUOTE_PATTERN = /"/g;
const DOUBLE_QUOTE_ESCAPE_PATTERN = /"/g;
const JS_EXTENSION_PATTERN = /\.js$/;
const MJS_EXTENSION_PATTERN = /\.mjs$/;
const FILE_EXTENSION_PATTERN = /\.[^.]+$/;

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

// Library class name mapping (simple name -> fully qualified name with namespace)
// Loaded dynamically from the framework registry.
let _classNameMap: Map<string, string> | undefined;

function loadClassNameMap(imports: any[]): Map<string, string> | undefined {
  try {
    const framework = getLoadedFramework();
    if (framework.classNameMapBuilder) {
      return framework.classNameMapBuilder.buildClassNameMap(imports);
    }
  } catch {
    // No loaded framework — no class name mapping available.
  }
  return undefined;
}

// DEPRECATED: Module-level mutable state (same as _emitBoardConstants above).
//
// Accumulates enum class names across all files compiled in one transpilation
// run so that renderExpression can use `::` instead of `.` for enum member
// access (e.g. I2CSpeed.STANDARD → I2CSpeed::STANDARD) even when the enum
// type is defined in a different source file (imported from @typehal/core).
const _emitEnumNames: Set<string> = new Set();

// DEPRECATED: Module-level mutable state (same as _emitBoardConstants above).
//
// Enum names whose members have values outside the 16-bit signed int range
// (i.e. > 32767 or < -32768).  On AVR, `int` is 16-bit, so these enums need
// an explicit `long` underlying type and their static_cast must use `long`.
const _largeEnumNames: Set<string> = new Set();

// Namespace names for scoped access (::) instead of (.)
const _namespaceNames: Set<string> = new Set();

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
// Overridden at the top of each emitCpp call.
let _defaultStrategy: PlatformStrategy = resolveStrategy("generic");

// Platform-reserved identifier names for the active strategy.
// Populated at the top of each emitCpp call from strategy.reservedNames().
// Used by escapeCppKeyword() so that Arduino macros (min, max, etc.) are
// only escaped when the ArduinoStrategy is active, not for other frameworks.
let _emitPlatformReservedNames: ReadonlySet<string> = new Set();

// Module-level tracking for static class members (class name → static member names).
// Populated during class emission so renderExpression can use :: for static access.
let _classStaticMembers: Map<string, Set<string>> = new Map();

// Module-level tracking for string-typed variables (for snprintf %s detection).
let _stringVarTypes: Set<string> = new Set();

// Module-level tracking for class getter/setter names (class name → property name → type).
// Populated during class emission so renderExpression can rewrite property access.
let _classAccessorNames: Map<string, Map<string, "getter" | "setter" | "both">> = new Map();
// Variable name → accessor map for instances of classes with getters/setters.
let _varAccessorNames: Map<string, Map<string, "getter" | "setter" | "both">> = new Map();
let _cArrayVarNames: Set<string> = new Set();

interface EmitterOptions {
  outDir: string;
  emitMode: EmitMode;
  target: TargetProfile;
  libdefs: Map<string, LibraryDefinition>;
  emitMaps: boolean;
  platformContext?: PlatformContext;
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

function renderExpression(expr: ExpressionIR, exprTransformer?: (expr: string) => string, strategy: PlatformStrategy = _defaultStrategy, classNameMap?: Map<string, string>): string {
  // Safety check
  if (!expr || typeof expr !== 'object' || !expr.kind) {
    return "/* invalid expression */";
  }

  switch (expr.kind) {
    case "number": {
      if (expr.cppType === "float" || !Number.isInteger(expr.value)) {
        const str = `${expr.value}`;
        return str.includes('.') || str.includes('e') || str.includes('E')
          ? `${str}f`
          : `${str}.0f`;
      }
      return `${expr.value}`;
    }
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
      // Map peripheral identifiers to platform-specific names (e.g. I2C0→Wire on Arduino)
      const mapped = mapPeripheralName(expr.value, strategy);
      if (mapped !== undefined) return mapped;
      return escapeCppKeyword(expr.value, _emitPlatformReservedNames);
    }
    case "raw": {
      // Apply transformation to raw expressions (for fixing pointer field access)
      // Use module-level _classNameMap if no classNameMap provided
      const effectiveClassNameMap = classNameMap ?? _classNameMap;
      let rawValue = exprTransformer ? exprTransformer(expr.value) : expr.value;
      let result = normalizeRawExpression(rawValue, strategy, effectiveClassNameMap);
      // Replace .size() with sizeof() for C-array variables
      result = result.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\.(?:length|size)(?:\(\))?/g, (match, varName) => {
        if (_stringVarTypes.has(varName)) return `strlen(${varName})`;
        if (_cArrayVarNames.has(varName)) return `(sizeof(${varName}) / sizeof(${varName}[0]))`;
        return match;
      });
      // Rewrite getter property access: s->reading → s->getReading()
      for (const [varName, accessors] of _varAccessorNames) {
        for (const [propName, kind] of accessors) {
          if (kind === "getter" || kind === "both") {
            const getterName = accessorGetterName(propName);
            // Match var->prop (not already a getter call)
            const pattern = new RegExp(`\\b${varName}->${propName}\\b(?!\\()`, "g");
            result = result.replace(pattern, `${varName}->${getterName}()`);
          }
        }
      }
      return result;
    }
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
          (expression: unknown) => renderExpression(expression as ExpressionIR, undefined, strategy),
          _currentPointerVarTypes,
          _currentKnownFunctionReturnTypes,
        );
        if (snprintfRender) {
          const bufferName = `__typehal_str_${++_currentScopeState.nextSnprintfTempId}`;
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
          (expression: unknown) => renderExpression(expression as ExpressionIR, undefined, strategy),
          _currentPointerVarTypes,
          _currentKnownFunctionReturnTypes,
        );
        if (arg) {
          const bufferName = `__typehal_str_${++_currentScopeState.nextSnprintfTempId}`;
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
    case "paren":
      return `(${renderExpression(expr.inner, exprTransformer, strategy)})`;
    case "method-call": {
      const argsText = expr.args.map(a => renderExpression(a, exprTransformer, strategy)).join(", ");
      const callee = exprTransformer ? exprTransformer(expr.callee) : expr.callee;
      return `${callee}(${argsText})`;
    }
    case "property-access": {
      const chain = extractPropertyChain(expr);
      if (chain) {
        // Check for Board.definition.* access first
        const boardDef = strategy.renderBoardDefinitionAccess(chain, _emitBoardConstants);
        if (boardDef !== undefined) return boardDef;

        // Check for peripheral stub property access (I2C0.isInitialized, SPI0.isInitialized, Serial.isInitialized)
        // These are TypeScript stubs that don't exist in C++ - return appropriate values
        const peripheralProperty = renderPeripheralProperty(chain, strategy);
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
      // Use :: for static class member access (e.g., ClassName.staticMethod())
      if (expr.object.kind === "identifier" && _classStaticMembers.has(expr.object.value)) {
        const statics = _classStaticMembers.get(expr.object.value)!;
        if (statics.has(expr.property)) {
          // Check if this property is a getter — render as Class::getProp()
          const accessors = _classAccessorNames.get(expr.object.value);
          if (accessors?.has(expr.property)) {
            const getterName = accessorGetterName(expr.property);
            return `${objStr}::${getterName}()`;
          }
          return `${objStr}::${expr.property}`;
        }
      }
      // Rewrite property access to getter call if the property is an accessor
      if (expr.object.kind === "identifier") {
        const accessors = _classAccessorNames.get(expr.object.value) ?? _varAccessorNames.get(expr.object.value);
        if (accessors?.has(expr.property)) {
          const getterName = accessorGetterName(expr.property);
          return `${objStr}->${getterName}()`;
        }
      }
      return `${objStr}.${expr.property}`;
    }
    case "typehal-call": {
      const renderA = (e: ExpressionIR) => renderExpression(e, exprTransformer, strategy);
      const translated = strategy.tryRenderTypehalCall(expr.receiver, expr.receiverKind, expr.method, expr.args, renderA, _emitBoardConstants, expr.interruptMode);
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
      return "0 /* unsupported_expr */";
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
  const safeName = escapeCppKeyword(name, _emitPlatformReservedNames);
  const normalizedType = normalizeCppTypeForTarget(cppType, strategy);
  const fnPtrMatch = normalizedType.match(/^(.+?)\s*\(\*\)\((.*)\)$/);
  if (fnPtrMatch) {
    const returnType = fnPtrMatch[1].trim();
    const params = fnPtrMatch[2].trim();
    const constPrefix = isConst ? "const " : "";
    return `${constPrefix}${returnType} (*${safeName})(${params})`;
  }
  const alreadyConstQualified = /^const\s+/.test(normalizedType);
  const constPrefix = isConst && !alreadyConstQualified ? "const " : "";
  const refMark = isRef ? "& " : " ";
  return `${constPrefix}${normalizedType}${refMark}${safeName}`;
}

function mapReturnType(functionName: string, returnType: string, strategy: PlatformStrategy): string {
  return strategy.mapReturnType(functionName, returnType);
}

function resolveTemplateReturnType(
  returnType: string,
  typeParameters: string[] | undefined,
  templateInterfaceNames: Set<string>,
  interfaceNamespaceMap: Map<string, string>,
): string {
  if (!typeParameters || typeParameters.length === 0) return returnType;
  if (templateInterfaceNames.has(returnType) && !returnType.includes("<")) {
    const ns = interfaceNamespaceMap.get(returnType);
    const qualified = ns ? `${ns}::${returnType}` : returnType;
    return `${qualified}<${typeParameters.join(", ")}>`;
  }
  return returnType;
}


function renderBoilerplate(program: ProgramIR): string {
  const chunks: string[] = [];

  const serializedProgram = JSON.stringify(program);

  const hasExistsHelper = serializedProgram.includes('typehal_exists(');
  if (hasExistsHelper) {
    chunks.push([
      'template <typename T>',
      'inline bool typehal_exists(T* value) {',
      '  return value != nullptr;',
      '}',
      '',
      'template <typename T>',
      'inline bool typehal_exists(const T&) {',
      '  return true;',
      '}',
      ''
    ].join('\n'));
  }

  const hasUndefinedSentinel = serializedProgram.includes('TYPEHAL_UNDEFINED');
  const hasNullishHelper = serializedProgram.includes('typehal_nullish(');
  if (hasUndefinedSentinel || hasNullishHelper) {
    chunks.push([
      '// Sentinel value representing JS undefined for integer types.',
      '// Uses INT_MIN from <limits.h> so it is correct for the target',
      '// platform (16-bit int on AVR, 32-bit int on ARM/ESP32, etc.).',
      '#include <limits.h>',
      '#ifndef TYPEHAL_UNDEFINED',
      '#define TYPEHAL_UNDEFINED INT_MIN',
      '#endif',
      '',
    ].join('\n'));
  }
  if (hasNullishHelper) {
    chunks.push([
      'template <typename T, typename U>',
      'inline T typehal_nullish(T value, U fallback) {',
      '  return (value == TYPEHAL_UNDEFINED) ? fallback : value;',
      '}',
      '',
      'template <typename T>',
      'inline T* typehal_nullish(T* value, T* fallback) {',
      '  return value != nullptr ? value : fallback;',
      '}',
      ''
    ].join('\n'));
  }

  if (program.boilerplates.has("async_stub")) {
    chunks.push("struct TsAsyncTask { bool done = true; };\n");
  }

  return chunks.join("\n");
}


function renderParameters(
  parameters: Array<{ name: string; cppType: string; defaultValue?: any }>,
  strategy: PlatformStrategy = _defaultStrategy,
  includeDefaults = true,
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
      if (includeDefaults && parameter.defaultValue !== undefined) {
        result += ` = ${renderExpression(parameter.defaultValue, undefined, strategy)}`;
      }
      return result;
    })
    .join(", ");
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

  // Check if any argument is a string_concat that should use snprintf
  if (strategy.useSnprintfForStrings() && args.length > 0) {
    const firstArg = args[0];
    if (firstArg.kind === "string_concat" && scopeState) {
      const snprintfRender = buildSnprintfRenderResult(
        firstArg,
        strategy,
        scopeState,
        (expression: unknown) => renderExpression(expression as ExpressionIR, undefined, strategy),
        pointerVarTypes,
        knownFunctionReturnTypes,
      );

      if (snprintfRender) {
        // Generate a temporary buffer for snprintf
        const bufferName = `__typehal_println_${++scopeState.nextSnprintfTempId}`;
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


function renderStatement(
  statement: StatementIR,
  forHeader: boolean = false,
  strategy: PlatformStrategy = _defaultStrategy,
  pointerVarTypes?: Map<string, string>,
  calleeTransformer?: (callee: string) => string,
  knownFunctionReturnTypes?: Map<string, string>,
): string {
  if (statement.kind === "typehal-call") {
    // Handle typehal-call statements (from fluent chains like UART0.config.baudRate(115200).begin())
    const renderA = (e: ExpressionIR) => renderExpression(e, undefined, strategy);
    const translated = strategy.tryRenderTypehalCall(
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
    // Handle typehal SDK calls via strategy (pin/serial/i2c/spi)
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
    // Rewrite setter assignments: c->count = val → c->setCount(val)
    if (statement.operator === "=" || statement.operator === "+=" || statement.operator === "-=") {
      const setterMatch = statement.target.match(/^(.+?)(->|\.)(\w+)$/);
      if (setterMatch) {
        const [, objStr, sep, propName] = setterMatch;
        const varName = objStr.trim();
        const accessors = _varAccessorNames.get(varName) ?? _classAccessorNames.get(varName);
        if (accessors?.has(propName)) {
          const kind = accessors.get(propName)!;
          if (kind === "setter" || kind === "both") {
            const setterName = accessorSetterName(propName);
            const renderedValue = renderExpression(statement.value, undefined, strategy);
            if (statement.operator === "=") {
              return forHeader
                ? `${varName}${sep}${setterName}(${renderedValue})`
                : `${varName}${sep}${setterName}(${renderedValue});`;
            }
            // For compound assignments on setters, get → compute → set
            const getterName = accessorGetterName(propName);
            const op = statement.operator.replace("=", "");
            return forHeader
              ? `${varName}${sep}${setterName}(${varName}${sep}${getterName}() ${op} ${renderedValue})`
              : `${varName}${sep}${setterName}(${varName}${sep}${getterName}() ${op} ${renderedValue});`;
          }
        }
      }
    }
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
    if (statement.keys && statement.keys.length > 0) {
      const objName = statement.object.kind === "identifier" ? statement.object.value : "_obj";
      const idxVar = `_ki_${objName}`;
      return `for (${strategy.defaultNumericType()} ${idxVar} = 0; ${idxVar} < ${statement.keys.length}; ${idxVar}++)`;
    }
    const varDecl = statement.variable;
    if (varDecl.kind === "var_decl") {
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
  const transformedType = transformTypeName(statement.cppType, _classNameMap);
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
      if (declaredType.startsWith("std::vector<") && strategy.needsStdVector()) {
        return forHeader
          ? `${declaration} = { ${elements} }`
          : `${declaration} = { ${elements} };`;
      }
      // Use "int" for "auto" element type since C arrays need explicit types
      const arrayType = statement.initializer.elementType === "auto" ? strategy.defaultNumericType() : statement.initializer.elementType;
      const safeName = escapeCppKeyword(statement.name);
      return forHeader
        ? `${arrayType} ${safeName}[] = { ${elements} }`
        : `${arrayType} ${safeName}[] = { ${elements} };`;
    }
    // Handle spread array initializers
    if (statement.initializer.kind === "spread_array") {
      const arrayType = statement.initializer.elementType === "auto" ? strategy.defaultNumericType() : statement.initializer.elementType;
      const spreadName = renderExpression(statement.initializer.spreadExpr, calleeTransformer, strategy);
      const renderedExtraElements = statement.initializer.additionalElements.map(e => renderExpression(e, calleeTransformer, strategy));
      const safeSpreadArrName = escapeCppKeyword(statement.name);
      if (strategy.needsStdVector()) {
        // Use std::vector copy + append for spread semantics
        const parts = [`std::vector<${arrayType}> ${safeSpreadArrName}(${spreadName})`];
        for (const elem of renderedExtraElements) {
          parts.push(`${safeSpreadArrName}.push_back(${elem})`);
        }
        return forHeader
          ? parts[0]
          : parts.join("; ") + ";";
      }
      // Fallback for non-vector platforms: emit with comment
      const initializerParts = [`/* spread from ${spreadName} */`, ...renderedExtraElements];
      const initializerText = initializerParts.join(", ");
      return forHeader
        ? `${arrayType} ${safeSpreadArrName}[] = { ${initializerText} }`
        : `${arrayType} ${safeSpreadArrName}[] = { ${initializerText} };`;
    }
    // Handle object initializers with inline struct definition
    if (statement.initializer.kind === "object") {
      const structName = `_${statement.name}_t`;

      // Collect nested struct definitions (deepest first)
      const nestedStructs = collectNestedStructDefs(
        statement.initializer, statement.name,
        pointerVarTypes, knownFunctionReturnTypes,
        undefined, undefined, _largeEnumNames,
      );
      const nestedDefs = nestedStructs.map(
        (ns) => `struct ${ns.structName} { ${ns.fields.map((f) => `${f.type} ${f.name};`).join(" ")} };`
      );

      const fieldDefs = statement.initializer.fields
        .map((f) => `${inferObjectFieldType(f.value, pointerVarTypes, knownFunctionReturnTypes, undefined, undefined, _largeEnumNames, statement.name, f.name, strategy.defaultNumericType(), (o, n) => strategy.resolvePinType?.(o, n))} ${f.name};`)
        .join(" ");
      const initValues = statement.initializer.fields
        .map((f) => {
          const renderExpr = (e: ExpressionIR) => renderExpression(e, calleeTransformer, strategy);
          const overridden = strategy.objectFieldInitializer(f.value, renderExpr);
          if (overridden !== undefined) return overridden;
          return renderExpr(f.value);
        })
        .join(", ");
      const safeStructName = escapeCppKeyword(statement.name);
      const parentStruct = forHeader
        ? `struct ${structName} { ${fieldDefs} } ${safeStructName} = { ${initValues} }`
        : `struct ${structName} { ${fieldDefs} } ${safeStructName} = { ${initValues} };`;
      return nestedDefs.length > 0
        ? `${nestedDefs.join(" ")} ${parentStruct}`
        : parentStruct;
    }
    return forHeader
      ? `${declaration} = ${renderExpression(statement.initializer, calleeTransformer, strategy)}`
      : `${declaration} = ${renderExpression(statement.initializer, calleeTransformer, strategy)};`;
  }

  return forHeader ? declaration : `${declaration};`;
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
  // Register namespace-internal enums and namespace names.
  for (const ns of program.namespaces) {
    _namespaceNames.add(ns.name);
    for (const e of ns.enums) {
      _emitEnumNames.add(e.name);
      if (e.members.some(m => m.value !== undefined && (m.value > 32767 || m.value < -32768))) {
        _largeEnumNames.add(e.name);
      }
    }
  }

  // Resolve the platform strategy for this target.
  const strategy: PlatformStrategy = options.strategy ?? resolveStrategy(options.target ?? "generic");
  // Inform the strategy about large enum names so it can decide on underlying type.
  strategy.setLargeEnumNames?.(_largeEnumNames);
  // Capture the strategy's platform-reserved names so escapeCppKeyword() only
  // escapes framework-specific macros (e.g. Arduino's min/max) when that
  // framework is actually active, not for generic or other frameworks.
  _emitPlatformReservedNames = strategy.reservedNames();

  ensureDir(options.outDir);

  // Build class name mapping for Arduino library imports (for namespace resolution)
  _classNameMap = loadClassNameMap(program.imports);

  // Perform single-pass program analysis to replace multiple traversals
  const programAnalysis = analyzeProgram(program);

  // Make analysis available to strategy methods via PlatformContext
  if (options.platformContext) {
    options.platformContext.analysis = programAnalysis;
  }

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
  const isrPrefix = isEntryFile ? 'main' : originalBaseName;
  const effectiveEmitMode: EmitMode = strategy.effectiveEmitMode(options.emitMode, isNpmPackage) as EmitMode;
  const sourceExtension = strategy.sourceExtension(isEntryFile, isNpmPackage);
  const headerPath = path.join(options.outDir, `${baseName}.h`);
  const sourcePath = path.join(options.outDir, `${baseName}.${sourceExtension}`);

  const includes: string[] = [];
  const symbolMap: Record<string, string> = {};
  let profileDiagnostics: Diagnostic[] = [];
  let shimLines: string[] = [];

  // Get native helper implementations from the strategy
  // Skip for non-entry files — they're emitted in the entry .ino and shared via includes
  const nativePolyfills = isEntryFile
    ? (strategy.generateNativePolyfills?.(program, options.platformContext) ?? [])
    : [];

  // Filter native polyfill helpers to only those actually used by the program
  const filteredNativePolyfills = filterPolyfillHelpers(nativePolyfills, programAnalysis.usedPolyfillHelpers);

  // Emit native helpers
  const allPolyfills = filteredNativePolyfills;
  const emittedPolyfills = allPolyfills.length > 0
    ? emitPolyfillBoilerplate(allPolyfills)
    : undefined;
  const hasAsyncRuntime = program.functions.some(fn => fn.isAsync);
  // True only when the Promise/MicrotaskQueue runtime was emitted (requires C++ stdlib).
  // On AVR this is false; typehal_pump_microtasks() must NOT be called.
  const hasPromiseRuntime = nativePolyfills.some(
    (p) => p.id === "async_runtime" && (p as any).hasPromiseRuntime === true
  );

  if (!isNpmPackage) {
    includes.push(...strategy.forcedIncludes(program, options.platformContext));
    Object.assign(symbolMap, strategy.symbolAliases(program, options.platformContext));
    shimLines = [...strategy.shimLines(program, options.platformContext)];
    // Filter shim lines for unused utilities
    if (!programAnalysis.usesStringConversion) {
      shimLines = shimLines.filter(l => !l.includes('std::string String('));
    }
    if (!programAnalysis.usesDateNow) {
      shimLines = shimLines.filter(l => !l.includes('namespace Date'));
    }
    if (!programAnalysis.usesMillis) {
      shimLines = shimLines.filter(l => !l.includes('millis()'));
    }
    profileDiagnostics = [...strategy.profileDiagnostics(program, options.platformContext)];
  }

  for (const imported of program.imports) {
    // Skip imports from typehal SDK modules — the symbols they export
    // (pin names like A0, D13, LED) are already provided by <Arduino.h>.
    if (isTypehalSDKImport(imported.moduleSpecifier, program.fileName)) {
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

  // Pre-scan interfaces to detect template struct names and namespace scopes
  const templateInterfaceNames = new Set<string>();
  const interfaceNamespaceMap = new Map<string, string>();
  for (const iface of program.interfaces) {
    if (iface.parentScope) {
      interfaceNamespaceMap.set(iface.name, iface.parentScope);
    }
    for (const field of iface.fields) {
      if (/^[A-Z]$/.test(field.cppType)) {
        templateInterfaceNames.add(iface.name);
        break;
      }
    }
  }

  const mappedFunctions = program.functions.map((fn) => ({
    name: mapFunctionName(fn.originalName, strategy),
    returnType: resolveTemplateReturnType(
      mapReturnType(mapFunctionName(fn.originalName, strategy), fn.returnType, strategy),
      fn.typeParameters,
      templateInterfaceNames,
      interfaceNamespaceMap,
    ),
    sourceSpan: fn.sourceSpan,
    leadingComments: fn.leadingComments,
    trailingComments: fn.trailingComments,
    parameters: fn.parameters,
    isAsync: fn.isAsync,
    typeParameters: fn.typeParameters,
    typeParameterConstraints: fn.typeParameterConstraints,
    isReadonlyReturnType: fn.isReadonlyReturnType,
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
          renderStatement,
        );
        asyncTaskClasses.push({ ...task, taskVarName: `${fn.originalName}Task` });
      }
    }
  }

  const headerLines: string[] = ["#pragma once", ""];
  let sourceLines: string[] = [];
  let cArrayVarNames: Set<string> = new Set();
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
        classNameMap: _classNameMap,
        enumNames: _emitEnumNames,
        largeEnumNames: _largeEnumNames,
        knownFunctionReturnTypes,
        pointerVarTypes: rendererPointerVarTypes,
        pointerStructFields,
        stringVarNames: _stringVarTypes,
        cArrayVarNames,
        namespaceNames: _namespaceNames,
        varAccessorNames: _varAccessorNames,
      });
      return statementRenderer.renderWithPrelude(statementToRender, false, calleeTransformer);
    };

    if (statement.kind === "var_decl" && shouldUseSnprintfForString(statement, strategy) && statement.initializer) {
      const snprintfRender = buildSnprintfRenderResult(
        statement.initializer,
        strategy,
        scopeState,
        (expression: unknown) => renderExpression(expression as ExpressionIR, undefined, strategy),
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
      shouldUseSnprintfForString(statement, strategy)
    ) {
      const snprintfRender = buildSnprintfRenderResult(
        statement.value,
        strategy,
        scopeState,
        (expression: unknown) => renderExpression(expression as ExpressionIR, undefined, strategy),
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
          (expression: unknown) => renderExpression(expression as ExpressionIR, undefined, strategy),
          pointerVarTypes,
          knownFunctionReturnTypes,
        );

        if (snprintfRender) {
          const bufferName = `__typehal_println_${++scopeState.nextSnprintfTempId}`;
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

    // Handle typehal-call for serial println/print with snprintf — delegated to strategy
    if (statement.kind === "typehal-call" && strategy.useSnprintfForStrings() && statement.args.length > 0) {
      const isSerialPrint = (statement.method === "println" || statement.method === "print") &&
        (strategy.isSerialPeripheral?.(statement.receiver) ?? false);

      if (isSerialPrint && strategy.renderSerialPrintWithSnprintf) {
        const firstArg = statement.args[0];
        if (firstArg.kind === "string_concat") {
          const snprintfRender = buildSnprintfRenderResult(
            firstArg,
            strategy,
            scopeState,
            (expression: unknown) => renderExpression(expression as ExpressionIR, undefined, strategy),
            pointerVarTypes,
            knownFunctionReturnTypes,
          );

          if (snprintfRender) {
            const bufferName = `__typehal_println_${++scopeState.nextSnprintfTempId}`;
            const rendered = strategy.renderSerialPrintWithSnprintf({
              receiver: statement.receiver,
              method: statement.method,
              bufferName,
            });
            if (rendered) {
              emitSnprintfLines(bufferName, snprintfRender, {
                declareBuffer: true,
                finalLine: rendered.finalLine,
              });
              emitCommentLines(statement.trailingComments, indent, (line) => appendSourceLine(line));
              return;
            }
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
      // Inject key variable assignment inside the loop body for for_in with known keys
      if (statement.keys && statement.keys.length > 0 && statement.variable.kind === "var_decl") {
        const objName = statement.object.kind === "identifier" ? statement.object.value : "_obj";
        const idxVar = `_ki_${objName}`;
        const varDecl = statement.variable;
        const safeName = escapeCppKeyword(varDecl.name);
        appendSourceLine(`${indent}  const char* ${safeName} = ${idxVar}_keys[${idxVar}];`);
      }
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
      // If there's a finally block but no catch, run finally before rethrow
      if (statement.finallyBlock && !statement.catchBlock) {
        const finallyScope = cloneEmissionScopeState(scopeState);
        for (const nested of statement.finallyBlock) {
          appendRenderedStatement(nested, `${indent}  `, pointerVarTypes, finallyScope);
        }
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
      }

      // If there's a finally block AND a catch block, the finally also runs
      // on the success path — emit it after the try-catch for that case.
      // (When catch fires, finally was already emitted inside catch above.)
      if (statement.finallyBlock && statement.catchBlock) {
        const finallyScope = cloneEmissionScopeState(scopeState);
        for (const nested of statement.finallyBlock) {
          appendRenderedStatement(nested, `${indent}`, pointerVarTypes, finallyScope);
        }
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
  if (programAnalysis.usesStdFunction && strategy.needsStdFunction()) {
    includes.push("<functional>");
  }
  if (programAnalysis.hasThrowStatements && strategy.needsStdExcept()) {
    includes.push("<stdexcept>");
  }
  // <type_traits> needed for static_assert on constrained type parameters
  if (program.functions.some(fn => fn.typeParameterConstraints && fn.typeParameterConstraints.size > 0)) {
    includes.push("<type_traits>");
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
  const globalPointerVarTypes = collectPointerVarTypes(allExecutableStatements, _classNameMap);


  // Collect callback functions from call arguments (e.g., attachInterrupt handlers)
  const callbackFunctions: { name: string; params: string[]; statements: StatementIR[]; debounceMs?: number }[] = [];
  let callbackCounter = 0;

  function collectCallbacks(statements: StatementIR[]): void {
    for (const stmt of statements) {
      if (stmt.kind === "call" || stmt.kind === "typehal-call") {
        for (const arg of stmt.args) {
          collectCallbackFromExpression(arg);
        }
      }
      // Scan var_decl initializers for callbacks in method-call expressions
      if (stmt.kind === "var_decl" && stmt.initializer) {
        collectCallbackFromExpression(stmt.initializer);
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
      if ("value" in stmt && stmt.value) {
        collectCallbackFromExpression(stmt.value);
      }
    }
  }

  function collectCallbackFromExpression(expr: ExpressionIR): void {
    // Handle top-level callback (e.g., in call statement args directly)
    if (expr.kind === "callback") {
      const callbackName = `${isrPrefix}_isr_${callbackCounter++}`;
      callbackFunctions.push({
        name: callbackName,
        params: expr.params,
        statements: expr.statements,
        debounceMs: expr.debounceMs,
      });
      (expr as any).kind = "identifier";
      (expr as any).value = callbackName;
      return;
    }
    if (expr.kind === "method-call") {
      for (const arg of expr.args) {
        if (arg.kind === "callback") {
          const callbackName = `${isrPrefix}_isr_${callbackCounter++}`;
          callbackFunctions.push({
            name: callbackName,
            params: arg.params,
            statements: arg.statements,
            debounceMs: arg.debounceMs,
          });
          (arg as any).kind = "identifier";
          (arg as any).value = callbackName;
        } else {
          collectCallbackFromExpression(arg);
        }
      }
    }
    // Recurse into other expression kinds that may contain nested method-calls
    if (expr.kind === "raw") return;
    if ("args" in expr && Array.isArray(expr.args)) {
      for (const arg of expr.args) { collectCallbackFromExpression(arg); }
    }
    if ("initializer" in expr && expr.initializer) { collectCallbackFromExpression(expr.initializer as ExpressionIR); }
    if ("value" in expr && expr.value && typeof expr.value === "object") { collectCallbackFromExpression(expr.value); }
    if ("left" in expr) { collectCallbackFromExpression(expr.left); }
    if ("right" in expr) { collectCallbackFromExpression(expr.right); }
    if ("condition" in expr && typeof expr.condition === "object") { collectCallbackFromExpression(expr.condition); }
    if ("whenTrue" in expr) { collectCallbackFromExpression(expr.whenTrue); }
    if ("whenFalse" in expr) { collectCallbackFromExpression(expr.whenFalse); }
    if ("inner" in expr) { collectCallbackFromExpression(expr.inner); }
    if ("object" in expr && typeof expr.object === "object" && expr.kind !== "instanceof") { collectCallbackFromExpression(expr.object); }
    if ("elements" in expr && Array.isArray(expr.elements)) {
      for (const e of expr.elements) { collectCallbackFromExpression(e); }
    }
  }

  collectCallbacks(filteredTopLevelExecutables);
  for (const fn of mappedFunctions) {
    collectCallbacks(fn.statements);
  }

  // Also scan class method statements for callbacks
  for (const cls of program.classes) {
    if (cls.constructor) {
      collectCallbacks(cls.constructor.statements);
    }
    for (const method of cls.methods) {
      collectCallbacks(method.statements);
    }
    for (const getter of cls.getters) {
      collectCallbacks(getter.statements);
    }
    for (const setter of cls.setters) {
      collectCallbacks(setter.statements);
    }
  }

  // Promote runtime var_decls that are referenced in ISR callbacks to file scope.
  // ISRs are emitted as file-scope free functions, so they can't access setup()-local variables.
  // We emit a forward declaration at file scope and convert the var_decl to an assignment in setup().
  function collectIdentifierNames(statements: StatementIR[]): Set<string> {
    const names = new Set<string>();
    function scanStmt(stmt: StatementIR) {
      if (stmt.kind === "var_decl") { names.add(stmt.name); }
      if ("target" in stmt && typeof stmt.target === "string") {
        // extract identifiers from target like "this->field"
      }
      if ("body" in stmt && Array.isArray(stmt.body)) { for (const s of stmt.body) scanStmt(s); }
      if ("thenBranch" in stmt && Array.isArray(stmt.thenBranch)) { for (const s of stmt.thenBranch) scanStmt(s); }
      if ("elseBranch" in stmt && Array.isArray(stmt.elseBranch)) { for (const s of stmt.elseBranch) scanStmt(s); }
      if ("cases" in stmt && Array.isArray(stmt.cases)) { for (const c of stmt.cases) for (const s of c.body) scanStmt(s); }
      if ("value" in stmt && stmt.value && typeof stmt.value === "object") { scanExpr(stmt.value); }
      if ("callee" in stmt && typeof stmt.callee === "string") {
        // extract identifiers from callee like "btn->check"
        const parts = stmt.callee.split(/[\.\-\>]/);
        for (const p of parts) { if (/^[a-zA-Z_]\w*$/.test(p)) names.add(p); }
      }
      if ("args" in stmt && Array.isArray(stmt.args)) { for (const a of stmt.args) scanExpr(a); }
    }
    function scanExpr(expr: ExpressionIR) {
      if (expr.kind === "identifier") { names.add(expr.value); }
      if ("left" in expr) { scanExpr(expr.left); }
      if ("right" in expr) { scanExpr(expr.right); }
      if ("value" in expr && expr.value && typeof expr.value === "object") { scanExpr(expr.value); }
      if ("elements" in expr && Array.isArray(expr.elements)) { for (const e of expr.elements) scanExpr(e); }
      if ("args" in expr && Array.isArray(expr.args)) { for (const a of expr.args) scanExpr(a); }
      if ("initializer" in expr && expr.initializer) { scanExpr(expr.initializer as ExpressionIR); }
      if ("condition" in expr && typeof expr.condition === "object") { scanExpr(expr.condition); }
      if ("whenTrue" in expr) { scanExpr(expr.whenTrue); }
      if ("whenFalse" in expr) { scanExpr(expr.whenFalse); }
      if ("inner" in expr) { scanExpr(expr.inner); }
      if ("object" in expr && typeof expr.object === "object" && expr.kind !== "instanceof") { scanExpr(expr.object); }
    }
    for (const stmt of statements) { scanStmt(stmt); }
    return names;
  }

  const promotedVarDecls = new Map<string, { cppType: string; index: number }>();
  if (callbackFunctions.length > 0 && filteredTopLevelExecutables.length > 0) {
    // Collect all identifiers referenced inside ISR callback bodies
    const isrIdentifiers = new Set<string>();
    for (const cb of callbackFunctions) {
      for (const id of collectIdentifierNames(cb.statements)) {
        isrIdentifiers.add(id);
      }
    }
    // Find runtime var_decls that are referenced in ISR callbacks
    for (let i = 0; i < filteredTopLevelExecutables.length; i++) {
      const stmt = filteredTopLevelExecutables[i];
      if (stmt.kind === "var_decl" && isrIdentifiers.has(stmt.name)) {
        const varType = normalizeCppTypeForTarget(stmt.cppType, strategy);
        promotedVarDecls.set(stmt.name, { cppType: varType, index: i });
        // Convert var_decl to assignment statement (remove type declaration)
        (filteredTopLevelExecutables[i] as any) = {
          kind: "assign",
          sourceSpan: stmt.sourceSpan,
          leadingComments: stmt.leadingComments,
          trailingComments: stmt.trailingComments,
          target: stmt.name,
          operator: "=",
          value: stmt.initializer,
        };
      }
    }
  }

  // Collect struct field types that are pointers - needed for correct -> access
  const pointerStructFields = new Set<string>();
  for (const stmt of allExecutableStatements) {
    if (stmt.kind === "var_decl" && stmt.initializer?.kind === "object") {
      const structName = stmt.name;
      for (const field of stmt.initializer.fields) {
        const fieldType = inferObjectFieldType(field.value, globalPointerVarTypes, knownFunctionReturnTypes, undefined, undefined, _largeEnumNames, structName, field.name, strategy.defaultNumericType(), (o, n) => strategy.resolvePinType?.(o, n));
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

    // Combine platform setup init code
    const allSetupInitStmts = [...setupInitStmts];

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
        originalName: epName,
        returnType,
        sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
        leadingComments: [`// Auto-generated ${epName}() for top-level statements`],
        trailingComments: undefined,
        parameters: [],
        isAsync: false,
        typeParameters: undefined,
        typeParameterConstraints: undefined,
        isReadonlyReturnType: false,
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
    const returnType = mapReturnType(entrypointFunctionName, isMain ? "int" : "void", strategy);
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
      typeParameters: undefined,
      typeParameterConstraints: undefined,
      isReadonlyReturnType: false,
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
      typeParameters: undefined,
      typeParameterConstraints: undefined,
      isReadonlyReturnType: false,
      statements: [],
    });
  }

  // Only generate main() for entry files when there's no loop-based strategy
  if (isEntryFile && hasAsyncRuntime && !strategy.requiresLoopFunction() && !mappedFunctions.some((fn) => fn.name === "main")) {
    mappedFunctions.push({
      name: "main",
      returnType: mapReturnType("main", "int", strategy),
      sourceSpan: { filePath: program.fileName, startOffset: 0, endOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
      leadingComments: ["// Auto-generated main() for async microtask pumping"],
      trailingComments: undefined,
      parameters: [],
      isAsync: false,
      typeParameters: undefined,
      typeParameterConstraints: undefined,
      isReadonlyReturnType: false,
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
    const guard = apiReservedEnums.has(enumDef.name) ? strategy.enumApiGuard(enumDef.name) : undefined;
    if (guard) {
      appendLine(guard.open);
    }
    appendLine(`${enumKeyword} ${enumDef.name}${underlyingType} {`);
    for (let i = 0; i < enumDef.members.length; i++) {
      const member = enumDef.members[i];
      const valueSuffix = member.value !== undefined ? ` = ${member.value}` : "";
      const commaSuffix = i < enumDef.members.length - 1 ? "," : "";
      // Prefix reserved names for platform compatibility
      const memberName = reservedNames.has(member.name)
        ? `_${member.name}`
        : member.name;
      appendLine(`  ${memberName}${valueSuffix}${commaSuffix}`);
    }
    appendLine("};");
    if (guard) {
      appendLine(guard.close);
    }
    emitCommentLines(enumDef.trailingComments, "", (line) => appendLine(line));
    appendLine("");
  }

  // Emit type aliases
  for (const typeAlias of program.typeAliases) {
    const appendLine = effectiveEmitMode === "split" ? appendHeaderLine : appendSourceLine;
    emitCommentLines(typeAlias.leadingComments, "", (line) => appendLine(line));

    // Object literal type aliases become struct definitions
    if (typeAlias.structFields && typeAlias.structFields.length > 0) {
      appendLine(`struct ${typeAlias.name} {`);
      for (const field of typeAlias.structFields) {
        const fieldType = normalizeCppTypeForTarget(field.cppType, strategy);
        appendLine(`  ${fieldType} ${field.name};`);
      }
      appendLine("};");
      emitCommentLines(typeAlias.trailingComments, "", (line) => appendLine(line));
      appendLine("");
      continue;
    }

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

  // Emit interfaces as C++ structs
  for (const iface of program.interfaces) {
    const appendLine = effectiveEmitMode === "split" ? appendHeaderLine : appendSourceLine;
    emitCommentLines(iface.leadingComments, "", (line) => appendLine(line));
    if (iface.fields.length > 0) {
      if (iface.parentScope) {
        appendLine(`namespace ${iface.parentScope} {`);
        interfaceNamespaceMap.set(iface.name, iface.parentScope);
      }
      // Detect type parameter names (single uppercase letters used as field types)
      const typeParams = new Set<string>();
      for (const field of iface.fields) {
        const rawType = field.cppType;
        if (/^[A-Z]$/.test(rawType)) {
          typeParams.add(rawType);
        }
      }
      if (typeParams.size > 0) {
        appendLine(`template<typename ${Array.from(typeParams).join(", typename ")}>`);
      }
      appendLine(`struct ${iface.name} {`);
      for (const field of iface.fields) {
        const fieldType = normalizeCppTypeForTarget(field.cppType, strategy);
        appendLine(`  ${fieldType} ${field.name};`);
      }
      appendLine("};");
      if (iface.parentScope) {
        appendLine("}");
      }
    }
    emitCommentLines(iface.trailingComments, "", (line) => appendLine(line));
    appendLine("");
  }

  // Emit top-level constant declarations BEFORE classes so that constants
  // used in class constructor default parameters are defined first.
  // ONLY emit compile-time declarations here (literals, simple identifiers).
  // Runtime declarations (new expressions, function calls) must go AFTER classes.
  const topLevelScope = createEmissionScopeState();
  for (const statement of emittedTopLevelStatements) {
    if (statement.kind === "var_decl" && statement.initializer && isRuntimeExpression(statement.initializer)) {
      continue;
    }
    appendRenderedStatement(statement, "", globalPointerVarTypes, topLevelScope);
  }
  if (emittedTopLevelStatements.some(s =>
    s.kind === "var_decl" &&
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
      const needsPublicSection = publicFields.length > 0 || publicMethods.length > 0 || classDef.constructor || callbackFunctions.length > 0;
      if (needsPublicSection) {
        appendSourceLine("  public:");
        if (callbackFunctions.length > 0) {
          for (const callback of callbackFunctions) {
            appendSourceLine(`    friend void ${callback.name}();`);
          }
          appendSourceLine("");
        }

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
            appendSourceLine(`    virtual ${returnType} ${escapeCppKeyword(method.name)}(${methodParams}) = 0;`);
            appendSourceLine("");
            continue;
          }

          appendSourceLine(`    ${staticPrefix}${returnType} ${escapeCppKeyword(method.name)}(${methodParams}) {`);
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
          appendSourceLine(`    ${normalizeCppTypeForTarget(method.returnType, strategy)} ${escapeCppKeyword(method.name)}(${methodParams}) {`);
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
          appendSourceLine(`    ${normalizeCppTypeForTarget(method.returnType, strategy)} ${escapeCppKeyword(method.name)}(${methodParams}) {`);
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

    appendSourceLine(`} // namespace ${ns.name}`);
    emitCommentLines(ns.trailingComments, "", (line) => appendSourceLine(line));
    appendSourceLine("");
  }

  if (effectiveEmitMode !== "split") {
    for (const callback of callbackFunctions) {
      appendSourceLine(`${strategy.isrFunctionAttribute?.() ?? ""}void ${callback.name}();`);
    }
    if (callbackFunctions.length > 0) {
      appendSourceLine("");
    }
  }

  // Emit classes
  // Forward-declare classes that are used as base classes so the compiler
  // knows they exist before the derived class definition.
  const localClassNames = new Set(program.classes.map(c => c.name));
  const baseClassesNeeded = new Set<string>();
  for (const classDef of program.classes) {
    if (classDef.extendsClass && !localClassNames.has(classDef.extendsClass)) {
      // Base class is NOT defined in this file — it's either from an import
      // or another module. No forward-declaration needed (the header handles it).
    } else if (classDef.extendsClass && localClassNames.has(classDef.extendsClass)) {
      baseClassesNeeded.add(classDef.extendsClass);
    }
  }
  // Emit forward declarations for locally-defined base classes that appear
  // AFTER their derived class in the program.classes array (ordering issue).
  for (const classDef of program.classes) {
    if (classDef.extendsClass && baseClassesNeeded.has(classDef.extendsClass)) {
      // Find the index of the base class and derived class
      const baseIdx = program.classes.findIndex(c => c.name === classDef.extendsClass);
      const derivedIdx = program.classes.findIndex(c => c.name === classDef.name);
      if (derivedIdx < baseIdx) {
        // Derived class comes before base — need forward declaration
        appendSourceLine(`class ${classDef.extendsClass};`);
      }
    }
  }

  // Track static member names per class for :: access rendering
  const classStaticMembers = new Map<string, Set<string>>();
  for (const classDef of program.classes) {
    const statics = new Set<string>();
    for (const method of classDef.methods) {
      if (method.isStatic) statics.add(method.name);
    }
    for (const field of classDef.fields) {
      // Check if field has isStatic (future-proofing)
      if ((field as any).isStatic) statics.add(field.name);
    }
    for (const getter of classDef.getters) {
      if (getter.isStatic) statics.add(getter.name);
    }
    for (const setter of classDef.setters) {
      if (setter.isStatic) statics.add(setter.name);
    }
    if (statics.size > 0) {
      classStaticMembers.set(classDef.name, statics);
    }
  }

  // Track string-typed variables for snprintf %s detection
  const stringVarTypes = new Set<string>();
  cArrayVarNames = new Set<string>();
  // Build per-function C-array variable tracking to avoid name collisions
  // across functions (e.g., `arr` can be a C array in one function and a
  // StaticArray in another).
  const fnCArrayVarNames = new Map<string, Set<string>>();
  const addCArrayIfNotMutable = (name: string, normalizedType: string, target: Set<string>) => {
    if (!normalizedType.startsWith("StaticArray<")) {
      target.add(name);
    }
  };
  for (const stmt of program.topLevelStatements) {
    if (stmt.kind === "var_decl") {
      const normalizedType = normalizeCppTypeForTarget(stmt.cppType, strategy);
      if (normalizedType === "const char*" || normalizedType === "char*") {
        stringVarTypes.add(stmt.name);
      }
      if (stmt.initializer?.kind === "array") {
        if (!normalizedType.startsWith("std::vector<") || !strategy.needsStdVector()) {
          addCArrayIfNotMutable(stmt.name, normalizedType, cArrayVarNames);
        }
      }
      if (stmt.initializer?.kind === "spread_array") {
        addCArrayIfNotMutable(stmt.name, normalizedType, cArrayVarNames);
      }
    }
  }
  for (let fi = 0; fi < mappedFunctions.length; fi++) {
    const fn = mappedFunctions[fi];
    const fnSet = new Set<string>();
    for (const stmt of fn.statements) {
      if (stmt.kind === "var_decl") {
        const normalizedType = normalizeCppTypeForTarget(stmt.cppType, strategy);
        if (normalizedType === "const char*" || normalizedType === "char*") {
          stringVarTypes.add(stmt.name);
        }
        if (stmt.initializer?.kind === "array") {
          if (!normalizedType.startsWith("std::vector<") || !strategy.needsStdVector()) {
            addCArrayIfNotMutable(stmt.name, normalizedType, fnSet);
          }
        }
        if (stmt.initializer?.kind === "spread_array") {
          addCArrayIfNotMutable(stmt.name, normalizedType, fnSet);
        }
      }
    }
    fnCArrayVarNames.set(String(fi), fnSet);
  }

  // Populate module-level tracking for renderExpression
  _classStaticMembers = classStaticMembers;
  _stringVarTypes = stringVarTypes;

  // Build accessor name map for expression rewriting
  const classAccessorNames = new Map<string, Map<string, "getter" | "setter" | "both">>();
  for (const classDef of program.classes) {
    const accessors = new Map<string, "getter" | "setter" | "both">();
    for (const g of classDef.getters) {
      accessors.set(g.name, accessors.has(g.name) ? "both" : "getter");
    }
    for (const s of classDef.setters) {
      accessors.set(s.name, accessors.has(s.name) ? "both" : "setter");
    }
    if (accessors.size > 0) {
      classAccessorNames.set(classDef.name, accessors);
    }
  }
  _classAccessorNames = classAccessorNames;

  // Build variable → accessor map by scanning var_decls for class-typed variables.
  const varAccessorNames = new Map<string, Map<string, "getter" | "setter" | "both">>();
  const allVarDecls: { name: string; cppType: string }[] = [];
  for (const stmt of program.topLevelStatements) {
    if (stmt.kind === "var_decl") allVarDecls.push(stmt);
  }
  for (const fn of mappedFunctions) {
    for (const stmt of fn.statements) {
      if (stmt.kind === "var_decl") allVarDecls.push(stmt);
    }
  }
  for (const v of allVarDecls) {
    const bareType = v.cppType.replace(/\*$/, "").replace(/^const\s+/, "");
    const accessors = classAccessorNames.get(bareType);
    if (accessors) {
      varAccessorNames.set(v.name, accessors);
    }
  }
  _varAccessorNames = varAccessorNames;

  for (const classDef of program.classes) {
    emitCommentLines(classDef.leadingComments, "", (line) => appendSourceLine(line));

    // Build inheritance clause: extends only (implements omitted — C++ has no
    // interface concept; structural compatibility is validated at the TS level)
    const inheritanceParts: string[] = [];
    if (classDef.extendsClass) {
      inheritanceParts.push(`public ${classDef.extendsClass}`);
    }
    // Note: TypeScript `implements` is omitted — C++ has no interface concept
    // and the interface type may not exist as a C++ class. The transpiler
    // validates structural compatibility at the TypeScript level already.
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
    const publicGetters = classDef.getters.filter(g => g.visibility === "public");
    const publicSetters = classDef.setters.filter(s => s.visibility === "public");
    const privateGetters = classDef.getters.filter(g => g.visibility === "private");
    const privateSetters = classDef.setters.filter(s => s.visibility === "private");
    const protectedGetters = classDef.getters.filter(g => g.visibility === "protected");
    const protectedSetters = classDef.setters.filter(s => s.visibility === "protected");

    const needsPublicSection = publicFields.length > 0 || publicMethods.length > 0 || publicGetters.length > 0 || publicSetters.length > 0 || classDef.constructor || callbackFunctions.length > 0;
    // Emit public section
    if (needsPublicSection) {
      appendSourceLine("public:");
      if (callbackFunctions.length > 0) {
        for (const callback of callbackFunctions) {
          appendSourceLine(`  friend void ${callback.name}();`);
        }
        appendSourceLine("");
      }

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
          appendSourceLine(`  virtual ${returnType} ${escapeCppKeyword(method.name)}(${methodParams}) = 0;`);
          appendSourceLine("");
          continue;
        }

        appendSourceLine(`  ${staticPrefix}${returnType} ${escapeCppKeyword(method.name)}(${methodParams}) {`);
        const methodScope = createChildEmissionScope(topLevelScope, method.parameters);
        for (const stmt of method.statements) {
          appendRenderedStatement(stmt, "    ", undefined, methodScope);
        }
        appendSourceLine("  }");
        appendSourceLine("");
      }

      // Public getters
      for (const getter of publicGetters) {
        const staticPrefix = getter.isStatic ? "static " : "";
        const returnType = normalizeCppTypeForTarget(getter.returnType, strategy);
        const getterName = accessorGetterName(getter.name);
        appendSourceLine(`  ${staticPrefix}${returnType} ${getterName}() const {`);
        const getterScope = createChildEmissionScope(topLevelScope, []);
        for (const stmt of getter.statements) {
          appendRenderedStatement(stmt, "    ", undefined, getterScope);
        }
        appendSourceLine("  }");
        appendSourceLine("");
      }

      // Public setters
      for (const setter of publicSetters) {
        const staticPrefix = setter.isStatic ? "static " : "";
        const paramType = normalizeCppTypeForTarget(setter.parameter.cppType, strategy);
        const setterName = accessorSetterName(setter.name);
        appendSourceLine(`  ${staticPrefix}void ${setterName}(${paramType} ${setter.parameter.name}) {`);
        const setterScope = createChildEmissionScope(topLevelScope, [setter.parameter]);
        for (const stmt of setter.statements) {
          appendRenderedStatement(stmt, "    ", undefined, setterScope);
        }
        appendSourceLine("  }");
        appendSourceLine("");
      }
    }

    // Emit private section
    if (privateFields.length > 0 || privateMethods.length > 0 || privateGetters.length > 0 || privateSetters.length > 0) {
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
        appendSourceLine(`  ${staticPrefix}${normalizeCppTypeForTarget(method.returnType, strategy)} ${escapeCppKeyword(method.name)}(${methodParams}) {`);
        const methodScope = createChildEmissionScope(topLevelScope, method.parameters);
        for (const stmt of method.statements) {
          appendRenderedStatement(stmt, "    ", undefined, methodScope);
        }
        appendSourceLine("  }");
        appendSourceLine("");
      }
      for (const getter of privateGetters) {
        const staticPrefix = getter.isStatic ? "static " : "";
        const returnType = normalizeCppTypeForTarget(getter.returnType, strategy);
        const getterName = accessorGetterName(getter.name);
        appendSourceLine(`  ${staticPrefix}${returnType} ${getterName}() const {`);
        const getterScope = createChildEmissionScope(topLevelScope, []);
        for (const stmt of getter.statements) {
          appendRenderedStatement(stmt, "    ", undefined, getterScope);
        }
        appendSourceLine("  }");
        appendSourceLine("");
      }
      for (const setter of privateSetters) {
        const staticPrefix = setter.isStatic ? "static " : "";
        const paramType = normalizeCppTypeForTarget(setter.parameter.cppType, strategy);
        const setterName = accessorSetterName(setter.name);
        appendSourceLine(`  ${staticPrefix}void ${setterName}(${paramType} ${setter.parameter.name}) {`);
        const setterScope = createChildEmissionScope(topLevelScope, [setter.parameter]);
        for (const stmt of setter.statements) {
          appendRenderedStatement(stmt, "    ", undefined, setterScope);
        }
        appendSourceLine("  }");
        appendSourceLine("");
      }
    }

    // Emit protected section
    if (protectedFields.length > 0 || protectedMethods.length > 0 || protectedGetters.length > 0 || protectedSetters.length > 0) {
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
        appendSourceLine(`  ${staticPrefix}${normalizeCppTypeForTarget(method.returnType, strategy)} ${escapeCppKeyword(method.name)}(${methodParams}) {`);
        const methodScope = createChildEmissionScope(topLevelScope, method.parameters);
        for (const stmt of method.statements) {
          appendRenderedStatement(stmt, "    ", undefined, methodScope);
        }
        appendSourceLine("  }");
        appendSourceLine("");
      }
      for (const getter of protectedGetters) {
        const staticPrefix = getter.isStatic ? "static " : "";
        const returnType = normalizeCppTypeForTarget(getter.returnType, strategy);
        const getterName = accessorGetterName(getter.name);
        appendSourceLine(`  ${staticPrefix}${returnType} ${getterName}() const {`);
        const getterScope = createChildEmissionScope(topLevelScope, []);
        for (const stmt of getter.statements) {
          appendRenderedStatement(stmt, "    ", undefined, getterScope);
        }
        appendSourceLine("  }");
        appendSourceLine("");
      }
      for (const setter of protectedSetters) {
        const staticPrefix = setter.isStatic ? "static " : "";
        const paramType = normalizeCppTypeForTarget(setter.parameter.cppType, strategy);
        const setterName = accessorSetterName(setter.name);
        appendSourceLine(`  ${staticPrefix}void ${setterName}(${paramType} ${setter.parameter.name}) {`);
        const setterScope = createChildEmissionScope(topLevelScope, [setter.parameter]);
        for (const stmt of setter.statements) {
          appendRenderedStatement(stmt, "    ", undefined, setterScope);
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

  // Emit forward declarations for promoted runtime var_decls (referenced in ISR callbacks).
  // These need file-scope visibility so ISR free functions can access them.
  // Must come AFTER class definitions so the type is known.
  if (promotedVarDecls.size > 0) {
    for (const [varName, info] of promotedVarDecls) {
      appendSourceLine(`${info.cppType} ${escapeCppKeyword(varName)} = nullptr;`);
    }
    appendSourceLine("");
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

      // Collect and emit nested struct definitions (deepest first)
      const nestedStructs = collectNestedStructDefs(
        statement.initializer, statement.name,
        globalPointerVarTypes, knownFunctionReturnTypes,
        knownTopLevelObjectTypes, knownTopLevelObjectFields, _largeEnumNames,
      );
      for (const ns of nestedStructs) {
        const nestedFieldDefs = ns.fields
          .map((f) => `${f.type} ${strategy.renameStructField(f.name)};`)
          .join(" ");
        appendHeaderLine(`struct ${ns.structName} { ${nestedFieldDefs} };`);
      }

      const fieldTypeEntries = statement.initializer.fields.map((field) => {
        const inferred = inferObjectFieldType(
          field.value,
          globalPointerVarTypes,
          knownFunctionReturnTypes,
          knownTopLevelObjectTypes,
          knownTopLevelObjectFields,
          _largeEnumNames,
          statement.name,
          field.name,
          strategy.defaultNumericType(),
          (o, n) => strategy.resolvePinType?.(o, n),
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

  if (effectiveEmitMode !== "split") {
    const excludedNames = new Set(strategy.forwardDeclarationExclusions?.() ?? []);
    for (const callback of callbackFunctions) {
      appendSourceLine(`${strategy.isrFunctionAttribute?.() ?? ""}void ${callback.name}();`);
    }
    for (const fn of mappedFunctions) {
      if (excludedNames.has(fn.name)) {
        continue;
      }
      const declarationParameterList = renderParameters(fn.parameters, strategy, true);
      if (fn.typeParameters && fn.typeParameters.length > 0) {
        appendSourceLine(`template<typename ${fn.typeParameters.join(", typename ")}>`);
      }
      appendSourceLine(`${fn.returnType} ${fn.name}(${declarationParameterList});`, {
        tsSpan: fn.sourceSpan,
        nodeKind: "function_declaration",
        symbolName: fn.name,
      });
    }
    if (callbackFunctions.length > 0 || mappedFunctions.some((fn) => !excludedNames.has(fn.name))) {
      appendSourceLine("");
    }
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

    appendSourceLine(`${strategy.isrFunctionAttribute?.() ?? ""}void ${callback.name}() {`);

    // Add debounce check if configured
    if (callback.debounceMs !== undefined && callback.debounceMs > 0) {
      appendSourceLine(`  volatile unsigned long now = ${strategy.currentTimeMillis()};`);
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

  for (let fi = 0; fi < mappedFunctions.length; fi++) {
    const fn = mappedFunctions[fi];
    const declarationParameterList = renderParameters(fn.parameters, strategy, true);
    const definitionParameterList = renderParameters(fn.parameters, strategy, false);
    const readonlyPrefix = fn.isReadonlyReturnType ? "const " : "";
    if (effectiveEmitMode === "split") {
      emitCommentLines(fn.leadingComments, "", (line) => appendHeaderLine(line));
      if (fn.typeParameters && fn.typeParameters.length > 0) {
        appendHeaderLine(`template<typename ${fn.typeParameters.join(", typename ")}>`);
      }
      appendHeaderLine(`${readonlyPrefix}${fn.returnType} ${fn.name}(${declarationParameterList});`, {
        tsSpan: fn.sourceSpan,
        nodeKind: "function_declaration",
        symbolName: fn.name,
      });
      emitCommentLines(fn.trailingComments, "", (line) => appendHeaderLine(line));
    }

    emitCommentLines(fn.leadingComments, "", (line) => appendSourceLine(line));
    if (fn.typeParameters && fn.typeParameters.length > 0) {
      appendSourceLine(`template<typename ${fn.typeParameters.join(", typename ")}>`);
    }
    appendSourceLine(`${readonlyPrefix}${fn.returnType} ${fn.name}(${definitionParameterList})`, {
      tsSpan: fn.sourceSpan,
      nodeKind: "function_definition",
      symbolName: fn.name,
    });
    appendSourceLine("{");
    // Inject microtask pumping into the async driver function
    const asyncDriverFn = strategy.asyncDriverFunctionName();
    if (hasPromiseRuntime && fn.name === asyncDriverFn) {
      appendSourceLine("  typehal_pump_microtasks();");
    }
    // Async tasks are driven by their state machine; don't emit the blocking body.
    if (fn.isAsync && hasAsyncRuntime) {
      appendSourceLine(`  // driven as cooperative task in ${asyncDriverFn}()`);
    } else {
      // Emit static_assert for constrained type parameters
      if (fn.typeParameterConstraints) {
        for (const [param, expr] of fn.typeParameterConstraints) {
          appendSourceLine(`  static_assert(${expr}, "${param} constraint violated");`);
        }
      }
      const functionScope = createChildEmissionScope(topLevelScope, fn.parameters);

      // Switch to this function's C-array variable set (avoids name collisions
      // across functions where the same variable name can be a C array in one
      // function and a StaticArray in another).
      const prevCArrayVarNames = cArrayVarNames;
      const prevModuleCArrayVarNames = _cArrayVarNames;
      cArrayVarNames = fnCArrayVarNames.get(String(fi)) ?? new Set();
      _cArrayVarNames = cArrayVarNames;

      // For the async driver function, emit async injection before the last return statement
      // so that the injection (e.g., thread spawn) is reachable.
      const shouldInjectAsync = hasAsyncRuntime && fn.name === asyncDriverFn;
      const lastStmt = fn.statements.length > 0 ? fn.statements[fn.statements.length - 1] : null;
      const lastIsReturn = lastStmt?.kind === "return";

      // Emit all statements except the last if it's a return and we need to inject async
      const stmtsToEmit = (shouldInjectAsync && lastIsReturn)
        ? fn.statements.slice(0, -1)
        : fn.statements;

      for (const statement of stmtsToEmit) {
        appendRenderedStatement(statement, "  ", globalPointerVarTypes, functionScope);
      }

      // Emit async loop injection before the final return
      if (shouldInjectAsync) {
        const taskNames = asyncTaskClasses.map(t => t.taskVarName);
        const injectionLines = strategy.asyncLoopInjection(taskNames, hasPromiseRuntime);
        for (const line of injectionLines) {
          appendSourceLine(`  ${line}`);
        }
      }

      // Now emit the final return (if we deferred it)
      if (shouldInjectAsync && lastIsReturn) {
        appendRenderedStatement(lastStmt, "  ", globalPointerVarTypes, functionScope);
      }
      cArrayVarNames = prevCArrayVarNames;
      _cArrayVarNames = prevModuleCArrayVarNames;
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

  // Non-entry Arduino files are emitted as header-only .h files
  if (sourceExtension === "h" && !isNpmPackage) {
    sourceLines.unshift("#pragma once", "");
  }

  // Post-process the final source for any remaining pointer member access
  // patterns that were not transformed earlier in the emitter.
  if (typeof globalPointerVarTypes !== "undefined" && globalPointerVarTypes.size > 0) {
    const pointerNames = Array.from(globalPointerVarTypes.keys()).filter((varName) => {
      const varType = globalPointerVarTypes.get(varName);
      return typeof varType === "string" && varType.trim().endsWith("*");
    });
    if (pointerNames.length > 0) {
      const sourceText = sourceLines.join("\n");
      const fixedSource = pointerNames.reduce((text, varName) => {
        const pattern = new RegExp(`\\b${varName}\\.`, "g");
        return text.replace(pattern, `${varName}->`);
      }, sourceText);
      sourceLines = fixedSource.split("\n");
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
