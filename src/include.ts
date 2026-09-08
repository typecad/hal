/**
 * Compile-time function: adds a C++ #include header to the generated output.
 * At runtime (tests, type-checking) this is a no-op.
 */
export function include(_text: string): void {}
