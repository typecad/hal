// ---------------------------------------------------------------------------
// @typecad/debug — Debug Types
//
// Type definitions for the TypeCAD debugger breakpoint system.
// ---------------------------------------------------------------------------

/**
 * A captured variable at a breakpoint.
 */
export interface CapturedVariable {
  /** Variable name */
  name: string;
  /** Whether this is a function (cannot print value) */
  isFunction?: boolean;
  /**
   * Coarse C++ type category, inferred from the declaration's annotation or
   * initializer shape (no TypeChecker is available in the debug path). Used by
   * printf-based codegens (ESP-IDF) to pick the right format specifier; ignored
   * by type-agnostic codegens (Arduino's Serial.println).
   */
  cppType?: DebugCppType;
  /**
   * 0-indexed source line on which this variable is declared. Used by the
   * scope analyzer to exclude not-yet-declared locals from a breakpoint's
   * variable dump (the dump is injected at the START of the breakpoint line,
   * before that line's own declaration executes).
   */
  declLine?: number;
}

/**
 * Coarse C++ type category for debug variable formatting.
 *
 * The debug preprocessor has no TypeChecker (it uses parse-only
 * createSourceFile), so this is inferred from explicit `: T` annotations and
 * initializer shape. `unknown` is the fallback; printf-based codegens cast to
 * `double` and use `%g` so the code always compiles.
 */
export type DebugCppType = 'bool' | 'int' | 'long' | 'float' | 'string' | 'unknown';

/**
 * A rich breakpoint with optional condition and log message.
 */
export interface RichBreakpoint {
  /** Source file path (relative or absolute) */
  file: string;
  /** Line number (1-indexed) */
  line: number;
  /** Optional condition expression (e.g., "counter > 5") */
  condition?: string;
  /** Optional log message with {variable} interpolation (e.g., "counter = {counter}") */
  logMessage?: string;
}

/**
 * Map of file paths to arrays of rich breakpoints.
 * Loaded from .typecad-hal/breakpoints.json.
 */
export type BreakpointMap = Record<string, RichBreakpoint[]>;

/**
 * Legacy breakpoint map format (just line numbers).
 * Used for backward compatibility.
 */
export type LegacyBreakpointMap = Record<string, number[]>;
