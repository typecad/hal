// ---------------------------------------------------------------------------
// Shared types for TypeCode platform infrastructure
//
// These types are used by both the CLI and framework packages.
// ---------------------------------------------------------------------------

/**
 * Source location span for mapping generated code back to TypeScript.
 */
export interface SourceSpan {
  filePath: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

/**
 * Diagnostic severity levels.
 */
export type DiagnosticSeverity = "info" | "warning" | "error";

/**
 * Diagnostic message from transpilation or emit.
 */
export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  line?: number;
  column?: number;
  code?: string;
  source?: string;
}

/**
 * Target profile for code generation.
 */
export type TargetProfile = "generic" | "arduino" | (string & {});

/**
 * Arduino-specific platform context.
 */
export interface ArduinoPlatformContext {
  fqbn?: string;
}

/**
 * Platform-specific context for code generation.
 */
export interface PlatformContext {
  arduino?: ArduinoPlatformContext;
  console?: {
    baudRate?: number;
  };
  [key: string]: unknown;
}