/** Compile-time function: registers a function argument as a standalone C++ callback.
 *  Returns the generated function name for use in rawCpp() templates.
 *  At runtime (tests, type-checking) this is a no-op. */
export function callback<T extends (...args: any[]) => any>(_fn: T): string {
  return "";
}
