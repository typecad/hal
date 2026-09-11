// ---------------------------------------------------------------------------
// Shared types for TypeCAD platform infrastructure
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
  /** Actionable fix suggestion, shown as a distinct code block in CLI output. */
  hint?: string;
  line?: number;
  column?: number;
  code?: string;
  source?: string;
  /**
   * Path (or basename) of the source file the diagnostic refers to. When set,
   * it is rendered in the diagnostic header so the location is not just
   * `(line,col)` but `path/to/file.ts (line,col)`. Emitters should prefer the
   * real file path from the originating node's sourceSpan, falling back to a
   * basename when the full path is unavailable.
   */
  filePath?: string;
  /** Text of the source line for display context. */
  sourceLine?: string;
  /**
   * A mechanical textual fix for this diagnostic, for editor quick-fixes.
   * `swap` replaces an identifier at its pin-argument sites (pin capability:
   * the first pin on this board that supports the operation). `edits` are
   * precise substitutions at 1-based positions, applied only where the
   * document still matches `fromText` (ownership: let→const promotion,
   * borrow-by-reference annotation). `title` names the lightbulb entry;
   * clients derive one from `swap` when absent.
   */
  fix?: {
    title?: string;
    swap?: { from: string; to: string };
    edits?: ReadonlyArray<{ line: number; column: number; fromText: string; toText: string }>;
  };
}

/**
 * Target profile for code generation.
 * Frameworks register their own profile names (e.g. "arduino", "stm32", "native").
 */
export type TargetProfile = "generic" | (string & {});

/**
 * Platform-specific context for code generation.
 * Frameworks add their own context via the index signature.
 */
export interface PlatformContext {
  /** Target architecture identifier (e.g., 'avr', 'esp32'). Populated from board config. */
  architecture?: string;
  /** Framework-specific data. Each framework reads its own key. */
  frameworkData?: Record<string, unknown>;
  [key: string]: unknown;
}