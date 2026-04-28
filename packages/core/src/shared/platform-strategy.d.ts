import type { ExpressionIR, ProgramIR } from './ir';
import type { Diagnostic, PlatformContext } from './types';
import type { BoardConstants } from './board-resolver';
import type { TypehalReceiverKind } from './typehal-symbols';
import type { RuntimePolyfillIR } from './polyfill-types';
export interface PlatformStrategy {
    /** Unique identifier for this strategy (e.g. "arduino", "generic"). */
    readonly id: string;
    /** System #include headers forced at the top of every emitted file. */
    forcedIncludes(program: ProgramIR, ctx?: PlatformContext): string[];
    /** Symbol aliases (TypeScript name → C++ name). */
    symbolAliases(program: ProgramIR, ctx?: PlatformContext): Record<string, string>;
    /** Extra shim lines emitted after includes (e.g. #define fallbacks). */
    shimLines(program: ProgramIR, ctx?: PlatformContext): string[];
    /** Diagnostics produced during profile resolution. */
    profileDiagnostics(program: ProgramIR, ctx?: PlatformContext): Diagnostic[];
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
    /** Map a C++ type string to the platform-safe equivalent. */
    normalizeCppType(typeName: string): string;
    /** Return type to use for a named function (e.g. setup/loop → void). */
    mapReturnType(functionName: string, returnType: string): string;
    /** Map a function name to the platform entrypoint (e.g. void/__arduino_setup__ → setup). */
    mapFunctionName(originalName: string): string;
    /**
     * Platform-specific normalisation of raw expression strings.
     * Applied after the common === → == and !== → != transforms.
     */
    normalizeRawExpression(value: string): string;
    /** How to render a null/undefined identifier value. */
    nullValue(): string;
    /**
     * Map a peripheral identifier to the platform-specific name.
     * E.g. Arduino: I2C0→Wire, SPI0→SPI, UART0→Serial.
     * Return `undefined` to keep the original name.
     */
    mapPeripheralIdentifier?(name: string): string | undefined;
    /** Whether string-literal + concatenation needs wrapping (Arduino: String(...)). */
    wrapStringConcat(leftRendered: string, rightRendered: string, leftIsString: boolean): string | undefined;
    /** Platform-specific expression for current time in milliseconds (e.g. "millis()" on Arduino). */
    currentTimeMillis(): string;
    /**
     * Whether string concat / template interpolation should use snprintf()
     * instead of Arduino String() objects.
     * When true, the emitter generates char[] buffers + snprintf() calls.
     */
    useSnprintfForStrings(): boolean;
    /**
     * Convert a float expression to an snprintf-compatible argument.
     * When implemented, the strategy returns a format specifier, a rendered arg
     * string, an estimated buffer length, and any prelude lines needed before
     * the snprintf call (e.g. dtostrf on Arduino).
     * Return undefined to let the emitter use generic %g / %.Nf formatting.
     *
     * @param renderedExpr The already-rendered C++ expression string.
     * @param precision    Decimal precision hint from the source literal, or undefined.
     * @param tempId       A unique integer for naming temporaries.
     */
    floatToSnprintfArg?(renderedExpr: string, precision: number | undefined, tempId: number): {
        format: string;
        arg: string;
        estimatedLength: number;
        preludeLines: string[];
    } | undefined;
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
     * Try to render a typehal SDK call expression (pin.read, Serial.print …).
     * Return `undefined` to fall back to default rendering.
     */
    tryRenderTypehalCall(receiver: string, receiverKind: TypehalReceiverKind, method: string, args: ReadonlyArray<ExpressionIR>, renderArg: (e: ExpressionIR) => string, boardConstants?: BoardConstants, interruptMode?: "FALLING" | "RISING" | "CHANGE" | "ALL"): string | undefined;
    /**
     * Try to render a Board.definition.* property access.
     * Return `undefined` to fall back to default rendering.
     */
    renderBoardDefinitionAccess(chain: string[], boardConstants?: BoardConstants): string | undefined;
    /**
     * Try to render a call statement as a platform string.
     * Return `undefined` to fall back to default rendering.
     */
    tryRenderCallStatement(callee: string, args: ReadonlyArray<ExpressionIR>, renderArg: (e: ExpressionIR) => string, boardConstants?: BoardConstants): string | undefined;
    /**
     * How to render a `throw` statement on this platform.
     * Arduino has no exceptions → emit `for(;;){}`.
     */
    renderThrow(valueExpr: string): string;
    /**
     * Transform console.log/error/warn calls to platform output.
     * Arduino → Serial.println; Generic → std::cout.
     */
    transformConsoleCall(method: string, renderedArgs: string, forHeader: boolean): string;
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
    /** Default numeric type for the platform (e.g. "int" on generic, "int32_t" on Arduino). */
    defaultNumericType(): string;
    /** Rename a struct field if it conflicts with platform-reserved names. */
    renameStructField(fieldName: string): string;
    /**
     * Override how a struct initializer field renders its value.
     * Return undefined to use default rendering.
     */
    structFieldInitializer(fieldValue: ExpressionIR, compiletimeVarNames: Set<string>, renderExpr: (e: ExpressionIR) => string): string | undefined;
    /**
     * Lines to inject into the loop/run function body to drive async tasks.
     */
    asyncLoopInjection(taskVarNames: string[], hasPromiseRuntime: boolean): string[];
    /**
     * The function name where microtask pumping and async task driving happens.
     * Arduino: "loop"; Generic: "main".
     */
    asyncDriverFunctionName(): string;
    /** Whether to skip a type alias for this platform (e.g. std::string on Arduino). */
    shouldSkipTypeAlias(cppType: string): boolean;
    /** Extra diagnostics to add during emit (e.g. Arduino split-mode ignored). */
    emitDiagnostics(emitMode: string): Diagnostic[];
    /**
     * Operations that are unsafe to use inside interrupt handlers.
     * Returns a map of operation name/prefix → { reason, severity }.
     * The analyzer uses prefix matching for entries like "I2C0" (matches I2C0.write, etc.).
     */
    isrUnsafeOperations?(): Map<string, {
        reason: string;
        severity: 'warning' | 'info';
    }>;
}
//# sourceMappingURL=platform-strategy.d.ts.map