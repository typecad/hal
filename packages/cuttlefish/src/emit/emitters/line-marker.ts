import { resolve } from 'node:path';
import type { SourceSpan } from '../../types.js';

/**
 * A previously-emitted source location, used for transition detection so we
 * emit a linemarker only when the source file or line actually changes.
 */
export interface EmittedSource {
  filePath: string;
  /** 0-based source line (matches SourceSpan.startLine). */
  line: number;
}

/**
 * Format a GCC linemarker for the given path and 0-based source line.
 * Output form: `# <line+1> "<path>"`.
 *
 * The path is normalized to forward slashes (Windows backslashes break GDB
 * source resolution from the ESP-IDF build directory) and resolved to an
 * absolute path so GDB finds the .ts file regardless of its cwd.
 *
 * GCC accepts both `#line N "F"` and the linemarker form `# N "F"`; we use
 * the latter because it's what GCC emits in preprocessed output and it flows
 * cleanly into DWARF.
 */
export function formatLinemarker(filePath: string, line: number): string {
  const absolute = resolve(filePath);
  const normalized = absolute.split(/[\\/]/).join('/');
  return `# ${line + 1} "${normalized}"`;
}

/**
 * Decide whether a linemarker should be emitted before the next source line,
 * given the previously-emitted marker (or null for the first one).
 *
 * Returns true only on file or line transition — this keeps the emitted C++
 * clean (one marker per source-span change, not per emitted C++ line, which
 * would be noisy and slow).
 */
export function shouldEmitMarker(prev: EmittedSource | null, next: EmittedSource): boolean {
  if (prev === null) return true;
  return prev.filePath !== next.filePath || prev.line !== next.line;
}

/**
 * Extract the {filePath, line} for transition tracking from a SourceSpan.
 * SourceSpan.startLine is 0-based; kept 0-based here so shouldEmitMarker
 * compares apples to apples (formatLinemarker does the +1 at format time).
 */
export function sourceKey(span: SourceSpan): EmittedSource {
  return { filePath: span.filePath, line: span.startLine };
}
