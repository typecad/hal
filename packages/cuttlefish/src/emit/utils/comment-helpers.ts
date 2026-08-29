/**
 * Comment handling utilities for C++ code emission.
 * Extracted from cpp-emitter.ts
 */

/**
 * Normalizes a comment string into an array of trimmed lines.
 * Removes empty lines and trailing whitespace.
 * 
 * @param comment The comment string (may contain newlines)
 * @returns Array of normalized comment lines
 */
function normalizeComment(comment: string): string[] {
  return comment
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

/**
 * Emits comment lines with proper indentation.
 * 
 * @param comments Optional array of comment strings to emit
 * @param indent The indentation string to prepend to each line
 * @param appendLine Function to call for each output line
 */
export function emitCommentLines(
  comments: string[] | undefined,
  indent: string,
  appendLine: (line: string) => void,
): void {
  for (const comment of comments ?? []) {
    for (const line of normalizeComment(comment)) {
      appendLine(`${indent}${line}`);
    }
  }
}