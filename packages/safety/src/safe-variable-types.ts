/** SafeVariable<T> — SEU-resistant storage with inverted-redundancy.
 *
 *  The cuttlefish transpiler resolves SafeVariable<number> to the C++
 *  template form SafeVariable<int> (or int32_t under --autosar), and the
 *  safety polyfill provides the template definition.
 *
 *  Arithmetic T only. The emitted C++ template carries a static_assert that
 *  rejects non-arithmetic types (notably string) and bool at compile time.
 *  float/double have explicit specializations (3-copy plain TMR — bitwise
 *  inversion is not defined for floating-point).
 *
 *  Usage:
 *    let x: SafeVariable<number> = SafeVariable(0);
 *    x.set(2000);
 *    const current = x.get();      // best-effort value
 *    if (x.hasFault()) { ... }     // triple corruption — get() is untrusted
 *    if (x.valid()) { ... }        // all three replicas agree and pass XOR checks
 */

export interface SafeVariable<T = number> {
  set(value: T): void;
  get(): T;
  valid(): boolean;
  /** True iff the most recent get() found zero valid replicas (triple
   *  corruption). Cleared by set() and by a subsequent get() that finds at
   *  least one valid replica. Check this after get() on safety-critical
   *  paths; a true return means the returned value is untrusted. */
  hasFault(): boolean;
}

export declare function SafeVariable(initial: number): SafeVariable<any>;
