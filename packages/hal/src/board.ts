/** Compile-time function: resolves a board definition path to a literal value.
 *  At runtime (tests, type-checking) this is a no-op that returns undefined. */
export function board(_path: string): any {
  return undefined;
}
