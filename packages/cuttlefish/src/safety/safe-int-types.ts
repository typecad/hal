/** SafeInt<T> — chainable bounds-checked signed-integer arithmetic.
 *
 *  The cuttlefish transpiler resolves SafeInt<number> to the C++ template
 *  form SafeInt<int32_t> (and SafeInt<int8_t>/<int16_t>/<int64_t> for the
 *  corresponding TS fixed-width aliases), and the safety polyfill provides
 *  the template definition.
 *
 *  Signed integer T only. The emitted C++ template carries a static_assert
 *  that rejects unsigned integers, bool, floating-point, and non-integer
 *  types (notably string) at compile time.
 *
 *  Mutating chain: every math operation returns the same SafeInt<T> (by
 *  reference) so calls chain: `x.add(5).mul(2).get()`. On overflow or
 *  division error, a sticky fault flag is set and subsequent operations in
 *  the chain become no-ops; get() returns the last good value. Check
 *  hasFault() (or valid()) after a chain on safety-critical paths.
 *
 *  Usage:
 *    let x: SafeInt<int32_t> = SafeInt(10);
 *    x.add(5).mul(2);             // mutating chain — x is now 30
 *    if (x.valid()) {
 *      const v: int32_t = x.get();
 *    }
 */

export interface SafeInt<T = number> {
  add(delta: T): SafeInt<T>;
  sub(delta: T): SafeInt<T>;
  mul(factor: T): SafeInt<T>;
  divide(d: T): SafeInt<T>;
  mod(d: T): SafeInt<T>;
  negate(): SafeInt<T>;
  absValue(): SafeInt<T>;
  get(): T;
  /** True iff a prior operation in this chain overflowed or hit a division
   *  error. Sticky — once set, stays set until reset(). While true, all
   *  further math operations are no-ops and get() returns the last good
   *  value. */
  hasFault(): boolean;
  /** !hasFault(). Symmetric with SafeVariable.valid(). */
  valid(): boolean;
  /** Clear the fault flag and set a new value. The only way to re-arm a
   *  faulted SafeInt without reconstructing it. */
  reset(newValue: T): void;
}

export declare function SafeInt<T>(initial: T): SafeInt<T>;
