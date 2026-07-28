/** Phantom type alias for SafeVariable<T>.
 *
 *  Like Shared<T> / Mutable<T>, this is a compile-time-only wrapper that
 *  the cuttlefish transpiler intercepts at type-resolution time. It does
 *  NOT alias to T — instead, the transpiler resolves SafeVariable<number>
 *  to the C++ template form SafeVariable<int32_t>, and the polyfill
 *  provides the template definition.
 *
 *  Usage:
 *    let targetSpeed: SafeVariable<number> = 1000;
 *    targetSpeed.set(2000);
 *    let ok = false;
 *    const current = targetSpeed.read(&ok);
 *    if (ok) { ... use current ... }
 */
export type SafeVariable<T = unknown> = T;

/** Result of a SafeVariable read when using the boolean-pointer form.
 *  Provided for documentation; the actual C++ lowers read(bool*) directly. */
export interface SafeVarResult<T = number> {
  readonly ok: boolean;
  readonly value: T;
}
