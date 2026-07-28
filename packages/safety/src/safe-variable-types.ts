/** SafeVariable<T> — SEU-resistant storage with inverted-redundancy.
 *
 *  The cuttlefish transpiler resolves SafeVariable<number> to the C++
 *  template form SafeVariable<int> (or int32_t under --autosar), and the
 *  safety polyfill provides the template definition.
 *
 *  Usage:
 *    let x: SafeVariable<number> = SafeVariable(0);
 *    x.set(2000);
 *    if (x.valid()) {
 *      const current = x.get();
 *    }
 */

export interface SafeVariable<T = number> {
  set(value: T): void;
  get(): T;
  valid(): boolean;
}

export declare function SafeVariable<T extends number>(initial: T): SafeVariable<T>;
