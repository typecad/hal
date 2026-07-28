/** SafeVariable<T> — SEU-resistant storage with inverted-redundancy.
 *
 *  The cuttlefish transpiler resolves SafeVariable<number> to the C++
 *  template form SafeVariable<int> (or int32_t under --autosar), and the
 *  safety polyfill provides the template definition.
 *
 *  Declared as an interface (not a type alias) so TypeScript recognizes
 *  the .set()/.get()/.valid() method calls.
 *
 *  Usage:
 *    let targetSpeed: SafeVariable<number> = 1000;
 *    targetSpeed.set(2000);
 *    if (targetSpeed.valid()) {
 *      const current = targetSpeed.get();
 *    }
 */
export interface SafeVariable<T = number> {
  set(value: T): void;
  get(): T;
  valid(): boolean;
}

/** Construct a SafeVariable with an initial value.
 *  At runtime this is a compile-time-only construct — the transpiler
 *  lowers `SafeVariable(0)` to the C++ `SafeVariable<int> x = 0;`
 *  constructor call. */
export declare function SafeVariable(initial: number): SafeVariable<number>;

