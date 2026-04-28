// ---------------------------------------------------------------------------
// @typehal/debug — Debug Types
//
// Type definitions for the TypeHAL debugger breakpoint system.
// ---------------------------------------------------------------------------

/**
 * A captured variable at a breakpoint.
 */
export interface CapturedVariable {
  /** Variable name */
  name: string;
  /** Whether this is a function (cannot print value) */
  isFunction?: boolean;
}

/**
 * A breakpoint location.
 */
export interface BreakpointLocation {
  /** Source file path (relative or absolute) */
  file: string;
  /** Line number (1-indexed) */
  line: number;
}

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
 * Loaded from .typehal/breakpoints.json.
 */
export type BreakpointMap = Record<string, RichBreakpoint[]>;

/**
 * Legacy breakpoint map format (just line numbers).
 * Used for backward compatibility.
 */
export type LegacyBreakpointMap = Record<string, number[]>;
