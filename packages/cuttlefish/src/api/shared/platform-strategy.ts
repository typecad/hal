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

import type { ExpressionIR, ProgramIR } from './ir.js';
import type { HALOpIR } from './hal-op-ir.js';
import type { Diagnostic, PlatformContext } from './types.js';
import type { BoardConstants } from './board-resolver.js';
import type { AsyncRuntimeConfig } from './async-types.js';
import type { RuntimePolyfillIR, StdLibSupport } from './polyfill-types.js';
import type { PlatformGraphicsStrategy } from './graphics-strategy.js';

// ---------------------------------------------------------------------------
// Sub-interface 1 — Profile, file shape & includes
// ---------------------------------------------------------------------------

export interface PlatformProfileStrategy {
  // ── Profile / includes ──────────────────────────────────────────────────

  /** System #include headers forced at the top of every emitted file. */
  forcedIncludes(program: ProgramIR, ctx?: PlatformContext): string[];

  /**
   * Filter the HAL-discovered required includes (from __includes metadata).
   * Frameworks that provide native peripheral drivers can strip stale Arduino
   * library includes here. Defaults to returning the includes unchanged.
   */
  filterRequiredIncludes?(includes: string[]): string[];

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

  /** cstring header name ("<cstring>" on hosted, "<string.h>" on embedded/AVR). */
  cstringHeader(): string;

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
   * the generated typecad-hal-env.d.ts file.
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

  /** Whether a C++ type behaves like a string (needs .c_str() or is const char*). */
  isStringLikeType(cppType: string): boolean;

  /** Whether a C++ type is a pointer (needs -> instead of .). */
  isPointerType(cppType: string): boolean;

  /** Map a function name to the platform entrypoint (e.g. void/__cuttlefish_entrypoint__ → setup). */
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

  /**
   * Enum names whose member access should render as bare C identifiers
   * (no scoped prefix).  For example, if "AnalogReference" is a passthrough
   * enum, `AnalogReference.INTERNAL` renders as just `INTERNAL` — useful
   * when the enum members map directly to platform preprocessor macros.
   */
  passthroughEnumNames?(): ReadonlySet<string>;

  /**
   * Default numeric type for the platform (e.g. "int" on hosted, "int32_t" on embedded).
   * Optional compliance context: when A3-9-1 is enforced, returns a fixed-width type.
   */
  defaultNumericType(compliance?: { isBanned(ruleId: string): boolean }): string;

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

  /** Whether string-literal + concatenation needs wrapping (e.g. String(...) on Arduino). */
  wrapStringConcat(leftRendered: string, rightRendered: string, leftIsString: boolean): string | undefined;

  /** Wrap an expression in the platform's string object type (e.g. String(...) on Arduino). */
  wrapStringObject(expr: string): string;

  /** Platform-specific expression for the monotonic runtime clock in milliseconds (e.g. "__tc_now_ms()" on Zephyr/native). */
  currentTimeMillis(): string;

  /**
   * Whether string concat / template interpolation should use snprintf()
   * instead of platform string objects.
   */
  useSnprintfForStrings(): boolean;

  /**
   * Whether integer division should be promoted to double to match JavaScript
   * semantics where 7 / 2 === 3.5.
   */
  promoteDivisionToDouble?(): boolean;

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
   * Try to render a Board.definition.* property access.
   * Return `undefined` to fall back to default rendering.
   */
  renderBoardDefinitionAccess(
    chain: string[],
    boardConstants?: BoardConstants,
  ): string | undefined;
  
  /**
   * Maps a generic peripheral name (e.g., I2C0, UART0) to a platform-specific C++ name (e.g., Wire, Serial).
   * Returns undefined if the strategy does not recognize the name.
   */
  mapPeripheralIdentifier?(name: string): string | undefined;

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
   * How to render a `throw` statement on this platform.
   * Embedded targets without exception support may emit an infinite loop or halt.
   */
  renderThrow(valueExpr: string): string;

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
   * Called when a cuttlefish-call for a serial peripheral has a snprintf-formatted argument.
   * Return `undefined` to use default method-call rendering.
   */
  renderSerialPrintWithSnprintf?(params: {
    receiver: string;
    method: string;
    bufferName: string;
  }): { finalLine: string } | undefined;

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
   * Identifier names that are platform *value/function-like macros* (e.g.
   * INPUT, OUTPUT, HIGH, LOW on Arduino) and therefore must pass through
   * verbatim when referenced in an expression — they must NOT be escaped
   * (suffixed with `_`) the way a conflicting declaration would be.
   *
   * These names typically also appear in `reservedNames()` (so user
   * declarations with these names are still escaped), but a *reference* to
   * such a macro should be emitted as-is.
   */
  passthroughMacroNames(): ReadonlySet<string>;

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
   * Frameworks return true for targets compiled with -fno-exceptions (e.g. Zephyr).
   */
  isExceptionSupportDisabled?(architecture: string): boolean;

  /**
   * Whether an array literal (`const a: T[] = [...]`) lowers to a fixed-capacity
   * `__tc_StaticArray<T, N>` (true) or a `std::vector<T>` (false). Embedded and
   * generic targets return true (StaticArray avoids heap); the native/hosted
   * target returns false (std::vector). Defaults to true. Used by the structural
   * array-method lowering to decide whether `.push`/`.pop`/`.indexOf` emit the
   * StaticArray wrapper's methods or the std::vector/__tc_* helper form.
   */
  promotesArrayLiteralsToStaticArray?(): boolean;

  /**
   * Whether this target runs on a preemptive RTOS where blocking calls
   * (e.g. vTaskDelay) yield the CPU to other tasks. When true, delay() inside
   * loop() does NOT freeze the async queue or UI rendering — the timing
   * validator suppresses the 'blocking-delay-in-loop' warning for plain delay().
   * Defaults to false (Arduino/AVR use cooperative scheduling where delay
   * freezes everything). ESP-IDF (FreeRTOS) returns true.
   */
  isRtosTarget?(): boolean;
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
 * Coarse C++ type category carried per debug variable, so printf-based codegens
 * (ESP-IDF) can pick the right format specifier. Inferred by the debug
 * preprocessor from AST shape (no TypeChecker); `unknown` is the fallback.
 * Mirrors `DebugCppType` in cuttlefish/src/debug/types.ts — duplicated here to
 * avoid a cross-module import from the api surface.
 */
export type DebugCppType = 'bool' | 'int' | 'long' | 'float' | 'string' | 'unknown';

/**
 * Debug code generation sub-interface.
 * Frameworks implement these to provide platform-specific debug output
 * (e.g., Serial.println on embedded, std::cout on hosted targets).
 */
export interface PlatformDebugStrategy {
  /**
   * Debug mode for the given build target. Controls whether `--debug` emits
   * GDB-oriented output (`#line` directives + debug config artifacts, value
   * `'gdb'`) or the legacy printf/Serial instrumentation (`'printf'`).
   *
   * Frameworks that support native source-level debugging for a chip return
   * `'gdb'` for that target; everything else inherits the `'printf'` default
   * and the existing instrumentation path is used unchanged.
   *
   * @param target the frameworkData.buildTarget value (e.g. 'esp32s3')
   */
  debugMode?(target?: string): 'gdb' | 'printf';
  /** Generate initialization code for the debug subsystem. */
  generateDebugInitCode?(): string[];
  /** Generate code for a breakpoint with optional condition and variable dump. */
  generateDebugBreakpointCode?(params: {
    fileName: string;
    lineNum: number;
    originalLine: string;
    variables: Array<{ name: string; isFunction?: boolean; cppType?: DebugCppType }>;
    normalizedCondition?: string;
    /**
     * Stable per-file ID assigned by the preprocessor. When present, the
     * codegen emits a `static bool __tc_bp_disabled_<id>` flag and wraps the
     * halt in `if (!__tc_bp_disabled_<id>)`, so the user can skip/disable this
     * one breakpoint for the rest of the run (the 's' key sets the flag).
     */
    breakpointId?: number;
  }): string[];
  /** Generate code for a logpoint with interpolated message parts. */
  generateDebugLogpointCode?(params: {
    fileName: string;
    lineNum: number;
    parts: Array<{ type: 'text' | 'variable'; value: string }>;
    variables: Array<{ name: string; isFunction?: boolean; cppType?: DebugCppType }>;
  }): string[];
}

// ---------------------------------------------------------------------------
// Sub-interface 9 — Async runtime configuration
// ---------------------------------------------------------------------------

export interface PlatformAsyncStrategy {
  /**
   * Returns the async runtime configuration for this platform.
   * The emitter uses this to decide:
   *   - Whether to include the MicrotaskQueue + Promise<T> runtime
   *   - How to implement waitForRising/waitForFalling
   *   - What headers to include
   *   - What queue capacity to use
   */
  getAsyncRuntimeConfig(): AsyncRuntimeConfig;

  /**
   * Generate the project-local board module for a board target — the
   * framework owns its board data (the Zephyr framework joins its generated
   * data pack with its curated soc descriptors). Returns the contents of
   * `.typecad-hal/board.ts` and `.typecad-hal/board.json`; the caller writes
   * them. Undefined = the framework has no board generation (the config's
   * board field then requires a different resolution path).
   */
  generateBoardModule?(target: string): { boardTs: string; boardJson: string } | undefined;

  /**
   * Lines to inject into the loop/run function body to drive async tasks.
   */
  asyncLoopInjection(taskVarNames: string[], config: AsyncRuntimeConfig): string[];

  /**
   * The function name where microtask pumping and async task driving happens.
   * Embedded targets: "loop"; Hosted: "main".
   */
  asyncDriverFunctionName(): string;

  /** Optional host event-loop scaffolding wrapping ui_tick in the driver
   *  function. Return null/undefined for single-shot (today's native behavior)
   *  or the Arduino repeatedly-called loop(). When provided, the emitter
   *  declares `flagName` as a bool, then wraps the per-frame work in
   *  `while (continueCondition) { preIteration; <tick>; postIteration; }`.
   *  Used by the SDL native target to pump SDL events and present each frame. */
  hostEventLoop?(): {
    flagName: string;
    continueCondition: string;
    preIteration: string;
    postIteration: string;
  } | null;
}

// ---------------------------------------------------------------------------
// Sub-interface 10 — HAL operation resolution
// ---------------------------------------------------------------------------

/**
 * Strategy for resolving semantic HAL operations to framework-specific C++.
 *
 * When the transpiler encounters a HAL method call that has been resolved to
 * a {@link HALOpIR} node, it calls {@link resolveHALOperation} so the
 * framework can produce the correct C++ for the target platform.
 *
 * Returning `undefined` signals that the strategy does not handle the
 * operation; the emitter will fall back to a default or raw emission.
 */
export interface PlatformHALStrategy {
  /**
   * Resolve a HAL operation to C++ code.
   *
   * @param op  The semantic hardware operation to translate.
   * @returns An object with either `code` (for statements) or `expression`
   *          (for value-returning operations), or `undefined` to fall back.
   */
  resolveHALOperation?(op: HALOpIR): { code?: string; expression?: string } | undefined;

  /**
   * Whether this target models GPIO pins. Hardware targets (Arduino, AVR,
   * ESP32) return true; host/desktop targets (SDL native) return false. Used to
   * gate GPIO-dependent APIs (ui.watchPin, ui.press) — when false, those APIs
   * produce a transpile-time diagnostic instead of emitting pinMode/
   * attachInterrupt calls that would be undefined symbols or silent no-ops.
   * Default true (preserves existing behavior for hardware strategies).
   */
  modelsGpio?(): boolean;

  // ── Atomic GPIO/timing primitives ───────────────────────────────────────
  // Cuttlefish asks the framework how to read/write a pin or delay. Returning
  // a C++ snippet string lets each framework speak its own HAL vocabulary;
  // cuttlefish never emits a Wiring/Arduino token by name. Composite
  // multi-statement sequences (display reset, I2C touch init) live with the
  // display drivers in the framework package, so cuttlefish only needs these
  // atomic operations.

  /**
   * C++ expression that reads the digital level of a pin (HIGH/LOW).
   * ArduinoStrategy returns `digitalRead(${pin})`. GenericStrategy returns a
   * documented no-op stub (no GPIO on host).
   */
  readDigitalPin?(pin: string): string;

  /**
   * C++ expression that reads a raw analog value from an ADC pin.
   * ArduinoStrategy returns `analogRead(${pin})`. GenericStrategy stubs.
   */
  readAnalogPin?(pin: string): string;

  /**
   * C++ statement that writes a digital level to a pin.
   * ArduinoStrategy returns `digitalWrite(${pin}, ${val})`. Cuttlefish does not
   * call this in the current emit path (display reset moves to the framework),
   * but it is part of the atomic surface for completeness/future use.
   */
  writeDigitalPin?(pin: string, val: string): string;

  /**
   * C++ statement that configures a pin's mode.
   * ArduinoStrategy returns `pinMode(${pin}, ${mode})`.
   */
  setPinMode?(pin: string, mode: string): string;

  /**
   * C++ statement that blocks for a number of milliseconds.
   * ArduinoStrategy returns `delay(${ms})`.
   */
  delayMs?(ms: string): string;

  /**
   * C++ statement that blocks for a number of microseconds.
   * ArduinoStrategy returns `delayMicroseconds(${us})`.
   */
  delayMicroseconds?(us: string): string;

  // ── HAL vocabulary introspection ─────────────────────────────────────────
  // Used by validators (adc-range-validation, pin-mode-validation) and
  // diagnostics (mermaid-builder, snprintf-helpers) that today hardcode the
  // Arduino HAL surface. GenericStrategy returns empty Sets.

  /**
   * The full set of HAL call names this framework's emitted code may contain
   * (digitalRead, analogRead, Serial, tone, millis, …). Used to recognize HAL
   * calls in rendered C++ text where no structured HAL-IR node is available.
   */
  halCallNames?(): ReadonlySet<string>;

  /** Membership test against {@link halCallNames}. Default false on generic. */
  isHalCall?(name: string): boolean;

  /**
   * The subset of {@link halCallNames} that return an analog-read integer
   * value (e.g. analogRead). Used by adc-range-validation to detect ADC reads
   * in lowered raw text.
   */
  analogReadCallNames?(): ReadonlySet<string>;
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
    PlatformDebugStrategy,
    PlatformAsyncStrategy,
    PlatformHALStrategy,
    PlatformGraphicsStrategy {
  /** Unique identifier for this strategy (e.g. "arduino", "generic"). */
  readonly id: string;
}
