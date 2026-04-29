// ---------------------------------------------------------------------------
// PlatformStrategy — abstract interface for target-specific C++ emit decisions
//
// Framework packages provide concrete implementations (e.g. ArduinoStrategy,
// NativeStrategy) so the emitter stays target-agnostic.  Each framework
// registers its strategy via the platform registry; the emitter calls methods
// on the interface without knowing which framework is active.
//
// The full interface is composed from focused sub-interfaces so that
// call-sites can accept a narrower type when they only need a subset of the
// strategy.  All existing implementations automatically satisfy every sub-interface
// since they already implement the full PlatformStrategy.
// ---------------------------------------------------------------------------

import type { ExpressionIR, ProgramIR } from './ir';
import type { Diagnostic, PlatformContext } from './types';
import type { BoardConstants } from './board-resolver';
import type { TypehalReceiverKind } from './typehal-symbols';
import type { RuntimePolyfillIR, StdLibSupport } from './polyfill-types';

// ---------------------------------------------------------------------------
// Sub-interface 1 — Profile, file shape & includes
// ---------------------------------------------------------------------------

export interface PlatformProfileStrategy {
  // ── Profile / includes ──────────────────────────────────────────────────

  /** System #include headers forced at the top of every emitted file. */
  forcedIncludes(program: ProgramIR, ctx?: PlatformContext): string[];

  /** Symbol aliases (TypeScript name → C++ name). */
  symbolAliases(program: ProgramIR, ctx?: PlatformContext): Record<string, string>;

  /** Extra shim lines emitted after includes (e.g. #define fallbacks). */
  shimLines(program: ProgramIR, ctx?: PlatformContext): string[];

  /** Diagnostics produced during profile resolution. */
  profileDiagnostics(program: ProgramIR, ctx?: PlatformContext): Diagnostic[];

  // ── File shape ──────────────────────────────────────────────────────────

  /** Extension for the output source file ("ino", "cpp", "c"). */
  sourceExtension(isEntryFile: boolean, isNpmPackage: boolean): string;

  /**
   * Returns code to insert at the beginning of setup()/main().
   * Used for platform-specific initialization (e.g., UART init for native console).
   */
  setupInitCode?(program: ProgramIR, ctx?: PlatformContext): string[];

  /** Name of the entrypoint function ("setup" for embedded, "main" for hosted). */
  entrypointFunctionName(): string;

  /** Whether a no-arg loop function must be auto-generated (embedded targets need loop()). */
  requiresLoopFunction(): boolean;

  /** Base name override for the output file (some targets use the output dir name). */
  overrideBaseName(originalBaseName: string, outDirBaseName: string, isEntryFile: boolean, isNpmPackage: boolean): string;

  /** Effective emit mode – some targets force "cpp" regardless of user choice. */
  effectiveEmitMode(requestedMode: string, isNpmPackage: boolean): string;

  // ── Include flags ───────────────────────────────────────────────────────

  /** Whether <iostream> should be included (for std::cout). */
  needsIostream(): boolean;

  /** Whether <string> should be included. */
  needsStdString(): boolean;

  /** Whether <vector> should be included. */
  needsStdVector(): boolean;

  /** Whether <stdexcept> should be included. */
  needsStdExcept(): boolean;

  /** Whether <functional> should be included. */
  needsStdFunction(): boolean;

  /** Math header name ("<cmath>" or "<math.h>"). */
  mathHeader(): string;

  /** Whether the vector operator<< overload should be emitted. */
  needsVectorOverload(): boolean;

  /** Whether a large enum needs an explicit underlying type. */
  needsLargeEnumUnderlying(): boolean;

  /** Whether to skip a type alias for this platform (e.g. std::string where unsupported). */
  shouldSkipTypeAlias(cppType: string): boolean;

  /** Extra diagnostics to add during emit. */
  emitDiagnostics(emitMode: string): Diagnostic[];

  /**
   * Names of functions that must be excluded from forward declarations
   * (e.g., entry points like setup/loop/main that the platform defines).
   */
  forwardDeclarationExclusions?(): string[];

  /**
   * Platform-specific ambient TypeScript type declarations appended to
   * the generated typehal-env.d.ts file.
   * Return an empty array if no platform-specific declarations are needed.
   */
  ambientTypeDeclarations?(): string[];
}

// ---------------------------------------------------------------------------
// Sub-interface 2 — Polyfill overrides
// ---------------------------------------------------------------------------

export interface PlatformPolyfillStrategy {
  /**
   * Returns a set of polyfill IDs that this strategy handles natively.
   * The emitter will skip emitting these polyfills from the global system.
   */
  nativePolyfills?(): Set<string>;

  /**
   * Returns polyfill IR for polyfills that this strategy provides natively.
   */
  generateNativePolyfills?(program: ProgramIR, ctx?: PlatformContext): RuntimePolyfillIR[];
}

// ---------------------------------------------------------------------------
// Sub-interface 3 — Type normalisation and renaming
// ---------------------------------------------------------------------------

export interface PlatformTypeStrategy {
  /** Map a C++ type string to the platform-safe equivalent. */
  normalizeCppType(typeName: string): string;

  /** Return type to use for a named function (e.g. setup/loop → void). */
  mapReturnType(functionName: string, returnType: string): string;

  /** Map a function name to the platform entrypoint (e.g. void/__typehal_entrypoint__ → setup). */
  mapFunctionName(originalName: string): string;

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

  /** Default numeric type for the platform (e.g. "int" on hosted, "int32_t" on embedded). */
  defaultNumericType(): string;

  /**
   * Inform the strategy which enums have values exceeding the signed 16-bit range.
   * The strategy can use this to choose an appropriate underlying type.
   */
  setLargeEnumNames?(names: ReadonlySet<string>): void;

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
}

// ---------------------------------------------------------------------------
// Sub-interface 4 — Expression rendering
// ---------------------------------------------------------------------------

export interface PlatformExpressionStrategy {
  /**
   * Platform-specific normalisation of raw expression strings.
   * Applied after the common === → == and !== → != transforms.
   */
  normalizeRawExpression(value: string): string;

  /** How to render a null/undefined identifier value. */
  nullValue(): string;

  /**
   * Map a peripheral identifier to the platform-specific name.
   * E.g. I2C0→Wire, SPI0→SPI, UART0→Serial on Arduino.
   * Return `undefined` to keep the original name.
   */
  mapPeripheralIdentifier?(name: string): string | undefined;

  /** Whether string-literal + concatenation needs wrapping (e.g. String(...) on Arduino). */
  wrapStringConcat(leftRendered: string, rightRendered: string, leftIsString: boolean): string | undefined;

  /** Platform-specific expression for current time in milliseconds (e.g. "millis()" on Arduino, "std::chrono" on hosted). */
  currentTimeMillis(): string;

  /**
   * Whether the given peripheral name represents a serial/UART output device.
   * Used to decide if println/print calls should be handled as serial output.
   */
  isSerialPeripheral?(name: string): boolean;

  /**
   * Whether string concat / template interpolation should use snprintf()
   * instead of platform string objects.
   */
  useSnprintfForStrings(): boolean;

  /**
   * Convert a float expression to an snprintf-compatible argument.
   * Return undefined to let the emitter use generic %g / %.Nf formatting.
   */
  floatToSnprintfArg?(
    renderedExpr: string,
    precision: number | undefined,
    tempId: number,
  ): { format: string; arg: string; estimatedLength: number; preludeLines: string[] } | undefined;

  /**
   * Try to render a typehal SDK call expression (pin.read, Serial.print …).
   * Return `undefined` to fall back to default rendering.
   */
  tryRenderTypehalCall(
    receiver: string,
    receiverKind: TypehalReceiverKind,
    method: string,
    args: ReadonlyArray<ExpressionIR>,
    renderArg: (e: ExpressionIR) => string,
    boardConstants?: BoardConstants,
    interruptMode?: "FALLING" | "RISING" | "CHANGE" | "ALL",
  ): string | undefined;

  /**
   * Try to render a Board.definition.* property access.
   * Return `undefined` to fall back to default rendering.
   */
  renderBoardDefinitionAccess(
    chain: string[],
    boardConstants?: BoardConstants,
  ): string | undefined;

  /**
   * Resolve the C++ type for a pin field on a board object (e.g., Pins.D2).
   * Return `undefined` to use default type inference.
   */
  resolvePinType?(objectName: string, fieldName: string): string | undefined;
}

// ---------------------------------------------------------------------------
// Sub-interface 5 — Statement rendering
// ---------------------------------------------------------------------------

export interface PlatformStatementStrategy {
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
   * Embedded targets without exception support may emit an infinite loop or halt.
   */
  renderThrow(valueExpr: string): string;

  /**
   * Transform console.log/error/warn calls to platform output.
   * Embedded targets → Serial.println; Hosted → std::cout.
   */
  transformConsoleCall(
    method: string,
    renderedArgs: string,
    forHeader: boolean,
  ): string;

  /**
   * Fallback value for an object initializer field on this platform.
   * Some targets use "0" for nested objects; hosted targets pass through.
   */
  objectFieldInitializer(fieldValue: ExpressionIR, renderExpr: (e: ExpressionIR) => string): string | undefined;

  /**
   * Override a class field type when platform-specific types differ.
   * E.g. interrupt handlers may need function-pointer types on embedded targets.
   */
  overrideClassFieldType(fieldName: string, normalizedType: string): string;

  /**
   * Render a serial print/println call that uses a pre-formatted snprintf buffer.
   * Called when a typehal-call for a serial peripheral has a snprintf-formatted argument.
   * Return `undefined` to use default method-call rendering.
   */
  renderSerialPrintWithSnprintf?(params: {
    receiver: string;
    method: string;
    bufferName: string;
  }): { finalLine: string } | undefined;

  /**
   * Render an I2C device read operation (readByte / readBytes).
   * The strategy should emit the platform-specific I2C transaction sequence
   * (e.g., Wire.beginTransmission / write / endTransmission / requestFrom / read on Arduino).
   * Return `undefined` to use default rendering.
   */
  renderI2CDeviceRead?(params: {
    receiver: string;
    wireName: string;
    address: string;
    register: string;
    count?: string;
    targetVarName: string;
  }): { preludeLines: string[]; returnValue: string; isMultiStatement?: boolean } | undefined;

  /**
   * Lines to inject into the loop/run function body to drive async tasks.
   */
  asyncLoopInjection(taskVarNames: string[], hasPromiseRuntime: boolean): string[];

  /**
   * The function name where microtask pumping and async task driving happens.
   * Embedded targets: "loop"; Hosted: "main".
   */
  asyncDriverFunctionName(): string;

  /**
   * Optional attribute prefix placed before ISR function declarations and
   * definitions.  Required on ESP32/Xtensa to place ISR code in IRAM so it
   * can execute while flash is being accessed.
   *
   * Returns an empty string on platforms that do not need an attribute
   * (e.g. AVR).  Includes a trailing space when non-empty.
   *
   * Example: `"IRAM_ATTR "` (note the trailing space).
   */
  isrFunctionAttribute?(): string;
}

// ---------------------------------------------------------------------------
// Sub-interface 6 — Safety: name guards & interrupt analysis
// ---------------------------------------------------------------------------

export interface PlatformSafetyStrategy {
  /**
   * Names that must not be re-declared because the platform already defines them
   * (e.g. platform macros like HIGH, LOW, Serial, A0 on Arduino).
   */
  reservedNames(): ReadonlySet<string>;

  /**
   * Enum class names already declared as typedefs by the platform framework.
   * These get a `#if !defined(...)` guard in the emitted code.
   */
  apiReservedEnumNames(): ReadonlySet<string>;

  /**
   * The preprocessor guard expression for API-reserved enums
   * (e.g. "ARDUINO_API_VERSION" on Arduino).
   */
  apiReservedEnumGuard(): string;

  /**
   * Operations that are unsafe to use inside interrupt handlers.
   * Returns a map of operation name/prefix → { reason, severity }.
   */
  isrUnsafeOperations?(): Map<string, { reason: string; severity: 'warning' | 'info' }>;

  /**
   * Whether heap allocation via `operator new` is unsafe on the given architecture.
   * Frameworks return true for memory-constrained targets (e.g. AVR with 2 KB SRAM).
   */
  isHeapAllocationUnsafe?(architecture: string): boolean;

  /**
   * Whether C++ exceptions are disabled on the given architecture.
   * Frameworks return true for targets compiled with -fno-exceptions (e.g. AVR-GCC).
   */
  isExceptionSupportDisabled?(architecture: string): boolean;
}

// ---------------------------------------------------------------------------
// Sub-interface 7 — Build configuration
// ---------------------------------------------------------------------------

export interface PlatformBuildStrategy {
  /** Queue capacity for the async microtask ring buffer. */
  asyncQueueCapacity(): number;

  /** Output subdirectory relative to base dir. */
  outputSubdirectory(baseName: string): string;

  /** Whether to generate a separate header file. */
  generateHeaderFile(): boolean;

  /**
   * Preprocessor guard for API-reserved enums.
   * Return undefined for no guard.
   */
  enumApiGuard(enumName: string): { open: string; close: string } | undefined;

  /** Standard library support for the given architecture. */
  getStdLibSupport(architecture?: string): StdLibSupport;
}

// ---------------------------------------------------------------------------
// Composed interface — backward-compatible aggregate of all sub-interfaces
// ---------------------------------------------------------------------------

/**
 * Debug code generation sub-interface.
 * Frameworks implement these to provide platform-specific debug output
 * (e.g., Serial.println on embedded, std::cout on hosted targets).
 */
export interface PlatformDebugStrategy {
  /** Generate initialization code for the debug subsystem. */
  generateDebugInitCode?(): string[];
  /** Generate code for a breakpoint with optional condition and variable dump. */
  generateDebugBreakpointCode?(params: {
    fileName: string;
    lineNum: number;
    originalLine: string;
    variables: Array<{ name: string; isFunction?: boolean }>;
    normalizedCondition?: string;
  }): string[];
  /** Generate code for a logpoint with interpolated message parts. */
  generateDebugLogpointCode?(params: {
    fileName: string;
    lineNum: number;
    parts: Array<{ type: 'text' | 'variable'; value: string }>;
    variables: Array<{ name: string; isFunction?: boolean }>;
  }): string[];
}

/**
 * Full platform strategy composed from focused sub-interfaces.
 *
 * Existing implementations that implement PlatformStrategy automatically
 * satisfy every sub-interface.  New code that only needs a subset can accept
 * e.g. `PlatformExpressionStrategy` instead of the full interface.
 */
export interface PlatformStrategy
  extends PlatformProfileStrategy,
    PlatformPolyfillStrategy,
    PlatformTypeStrategy,
    PlatformExpressionStrategy,
    PlatformStatementStrategy,
    PlatformSafetyStrategy,
    PlatformBuildStrategy,
    PlatformDebugStrategy {
  /** Unique identifier for this strategy (e.g. "arduino", "generic"). */
  readonly id: string;
}
