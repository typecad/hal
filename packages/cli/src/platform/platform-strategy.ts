// ---------------------------------------------------------------------------
// PlatformStrategy — abstract interface for target-specific C++ emit decisions
//
// Every `target === "arduino"` branch in cpp-emitter.ts is captured here as
// a strategy method.  Board packages provide concrete implementations so the
// emitter stays target-agnostic.
// ---------------------------------------------------------------------------

import type { ExpressionIR, ProgramIR, StatementIR } from "../ir/model";
import type { Diagnostic, PlatformContext } from "../types";
import type { BoardConstants } from "../ir/board-resolver";
import type { TypecodeReceiverKind } from "../ir/typecode-symbols";
import type { RuntimePolyfillIR } from "../polyfill/types";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface PlatformStrategy {
  /** Unique identifier for this strategy (e.g. "arduino", "generic"). */
  readonly id: string;

  // ── Profile / includes ──────────────────────────────────────────────────

  /** System #include headers forced at the top of every emitted file. */
  forcedIncludes(program: ProgramIR, ctx?: PlatformContext): string[];

  /** Symbol aliases (TypeScript name → C++ name). */
  symbolAliases(program: ProgramIR, ctx?: PlatformContext): Record<string, string>;

  /** Extra shim lines emitted after includes (e.g. #define fallbacks). */
  shimLines(program: ProgramIR, ctx?: PlatformContext): string[];

  /** Diagnostics produced during profile resolution. */
  profileDiagnostics(program: ProgramIR, ctx?: PlatformContext): Diagnostic[];

  // ── Polyfill overrides ──────────────────────────────────────────────────

  /**
   * Returns a set of polyfill IDs that this strategy handles natively.
   * The emitter will skip emitting these polyfills from the global system.
   *
   * For example, a native board package might return new Set(['console'])
   * to indicate it provides its own console.log implementation.
   */
  nativePolyfills?(): Set<string>;

  /**
   * Returns polyfill IR for polyfills that this strategy provides natively.
   * This allows board packages to provide their own console.log, etc.
   *
   * The returned polyfills will be emitted instead of the global polyfills.
   */
  generateNativePolyfills?(program: ProgramIR, ctx?: PlatformContext): RuntimePolyfillIR[];

  // ── File shape ──────────────────────────────────────────────────────────

  /** Extension for the output source file ("ino", "cpp", "c"). */
  sourceExtension(isEntryFile: boolean, isNpmPackage: boolean): string;

  /**
   * Returns code to insert at the beginning of setup()/main().
   * Used for platform-specific initialization (e.g., UART init for native console).
   */
  setupInitCode?(program: ProgramIR, ctx?: PlatformContext): string[];

  /** Name of the entrypoint function ("setup" for Arduino, "main" for others). */
  entrypointFunctionName(): string;

  /** Whether a no-arg loop function must be auto-generated (Arduino needs loop()). */
  requiresLoopFunction(): boolean;

  /** Base name override for the output file (Arduino uses the output dir name). */
  overrideBaseName(originalBaseName: string, outDirBaseName: string, isEntryFile: boolean, isNpmPackage: boolean): string;

  /** Effective emit mode – Arduino forces "cpp", generic uses the user's choice. */
  effectiveEmitMode(requestedMode: string, isNpmPackage: boolean): string;

  // ── Type normalisation ──────────────────────────────────────────────────

  /** Map a C++ type string to the platform-safe equivalent. */
  normalizeCppType(typeName: string): string;

  /** Return type to use for a named function (e.g. setup/loop → void). */
  mapReturnType(functionName: string, returnType: string): string;

  /** Map a function name to the platform entrypoint (e.g. void/__arduino_setup__ → setup). */
  mapFunctionName(originalName: string): string;

  // ── Expression rendering ────────────────────────────────────────────────

  /**
   * Platform-specific normalisation of raw expression strings.
   * Applied after the common === → == and !== → != transforms.
   */
  normalizeRawExpression(value: string): string;

  /** How to render a null/undefined identifier value. */
  nullValue(): string;

  /** Whether string-literal + concatenation needs wrapping (Arduino: String(...)). */
  wrapStringConcat(leftRendered: string, rightRendered: string, leftIsString: boolean): string | undefined;

  /**
   * Prefix an enum member name if it conflicts with a platform macro.
   * Return the original name if no rename is needed.
   */
  renameEnumMember(enumName: string, memberName: string): string;

  /**
   * Whether enum member access should be wrapped in static_cast<int/long>.
   * Returns the cast type ("int", "long") or undefined for no cast.
   */
  enumCastType(enumName: string): string | undefined;

  /**
   * Try to render a typecode SDK call expression (pin.read, Serial.print …).
   * Return `undefined` to fall back to default rendering.
   */
  tryRenderTypecodeCall(
    receiver: string,
    receiverKind: TypecodeReceiverKind,
    method: string,
    args: ReadonlyArray<ExpressionIR>,
    renderArg: (e: ExpressionIR) => string,
    boardConstants?: BoardConstants,
  ): string | undefined;

  /**
   * Try to render a Board.definition.* property access.
   * Return `undefined` to fall back to default rendering.
   */
  renderBoardDefinitionAccess(
    chain: string[],
    boardConstants?: BoardConstants,
  ): string | undefined;

  // ── Statement rendering ─────────────────────────────────────────────────

  /**
   * Try to render a call statement as a platform string.
   * Return `undefined` to fall back to default rendering.
   */
  tryRenderCallStatement(
    callee: string,
    args: ReadonlyArray<ExpressionIR>,
    renderArg: (e: ExpressionIR) => string,
    boardConstants?: BoardConstants,
  ): string | undefined;

  /**
   * How to render a `throw` statement on this platform.
   * Arduino has no exceptions → emit `for(;;){}`.
   */
  renderThrow(valueExpr: string): string;

  /**
   * Transform console.log/error/warn calls to platform output.
   * Arduino → Serial.println; Generic → std::cout.
   */
  transformConsoleCall(
    method: string,
    renderedArgs: string,
    forHeader: boolean,
  ): string;

  /**
   * Fallback value for an object initializer field on this platform.
   * Arduino → "0" for nested objects; generic passes through.
   */
  objectFieldInitializer(fieldValue: ExpressionIR, renderExpr: (e: ExpressionIR) => string): string | undefined;

  /**
   * Override a class field type when platform-specific types differ.
   * E.g. Arduino: _interruptHandler → "void (*)(void)".
   */
  overrideClassFieldType(fieldName: string, normalizedType: string): string;

  // ── Name guards ─────────────────────────────────────────────────────────

  /**
   * Names that must not be re-declared because the platform already defines them
   * (e.g. Arduino macros: HIGH, LOW, Serial, A0 …).
   */
  reservedNames(): ReadonlySet<string>;

  /**
   * Enum class names already declared as typedefs by the platform framework.
   * These get a `#if !defined(...)` guard in the emitted code.
   */
  apiReservedEnumNames(): ReadonlySet<string>;

  /**
   * The preprocessor guard expression for API-reserved enums
   * (e.g. "ARDUINO_API_VERSION" for Arduino).
   */
  apiReservedEnumGuard(): string;

  // ── Includes ────────────────────────────────────────────────────────────

  /** Whether <iostream> should be included (for std::cout). */
  needsIostream(): boolean;

  /** Whether <string> should be included. */
  needsStdString(): boolean;

  /** Whether <vector> should be included. */
  needsStdVector(): boolean;

  /** Whether <stdexcept> should be included. */
  needsStdExcept(): boolean;

  /** Math header name ("<cmath>" or "<math.h>"). */
  mathHeader(): string;

  /** Whether the vector operator<< overload should be emitted. */
  needsVectorOverload(): boolean;

  // ── Enum underlying type ────────────────────────────────────────────────

  /** Whether a large enum needs an explicit underlying type. */
  needsLargeEnumUnderlying(): boolean;

  // ── Struct field handling ───────────────────────────────────────────────

  /** Rename a struct field if it conflicts with platform-reserved names. */
  renameStructField(fieldName: string): string;

  /**
   * Override how a struct initializer field renders its value.
   * Return undefined to use default rendering.
   */
  structFieldInitializer(
    fieldValue: ExpressionIR,
    compiletimeVarNames: Set<string>,
    renderExpr: (e: ExpressionIR) => string,
  ): string | undefined;

  // ── Async / cooperative scheduling ──────────────────────────────────────

  /**
   * Lines to inject into the loop/run function body to drive async tasks.
   */
  asyncLoopInjection(taskVarNames: string[], hasPromiseRuntime: boolean): string[];

  /**
   * The function name where microtask pumping and async task driving happens.
   * Arduino: "loop"; Generic: "main".
   */
  asyncDriverFunctionName(): string;

  // ── Type aliases ────────────────────────────────────────────────────────

  /** Whether to skip a type alias for this platform (e.g. std::string on Arduino). */
  shouldSkipTypeAlias(cppType: string): boolean;

  // ── Split-mode diagnostic ───────────────────────────────────────────────

  /** Extra diagnostics to add during emit (e.g. Arduino split-mode ignored). */
  emitDiagnostics(emitMode: string): Diagnostic[];
}
