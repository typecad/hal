import type { RuntimePolyfillIR } from "../../api/index.js";
import { emitSafeTraits } from "./safe-traits.js";

/** SafeInt<T> polyfill: chainable bounds-checked signed-integer arithmetic.
 *
 *  Mutating chain — every math op returns SafeInt<T>& so calls compose:
 *    x.add(5).mul(2).get()
 *
 *  Sticky-fault overflow policy: on overflow or division error, set fault_
 *  and stop computing. Subsequent ops are no-ops returning *this. get()
 *  returns the last good value. hasFault()/valid() inspect the flag;
 *  reset() clears it.
 *
 *  Overflow detection uses portable pure-C++14 PRE-CHECKS (bounds tests
 *  before the assignment). The reconstruction trick would compute first
 *  then check, but the initial computation is signed-overflow UB. Pre-checks
 *  avoid the UB, work at every width including int64_t (no wider promotion
 *  type needed), and need no __builtin_*_overflow (a GCC/clang extension
 *  that would require an AUTOSAR deviation).
 *
 *  NO <type_traits> / <limits> includes: AVR's toolchain ships neither
 *  header. The type constraint (static_assert) and the per-width bounds come
 *  from the shared hand-rolled __tc_safe_traits block (safe-traits.ts), which
 *  uses only core-language features (template specialization, static_cast,
 *  constexpr) that every supported target — including AVR's avr-gcc — has.
 *
 *  AUTOSAR C++14 compliance:
 *  - static_assert on T (rejects unsigned, bool, float, non-integer)
 *  - noexcept on all methods (A15-0-2)
 *  - [[nodiscard]] on get/hasFault/valid (A0-1-1)
 *  - constexpr constructor
 *  - static_cast throughout (no C-casts M5-0-7, no builtins M5-0-10,
 *    no malloc A18-5-10). Zero deviations required.
 */
export function safeIntPolyfill(): RuntimePolyfillIR {
  return {
    kind: "polyfill",
    id: "safety_safe_int",
    domain: "embedded",
    requiredIncludes: [],
    forwardDeclarations: [],
    helperStructs: [],
    helperFunctions: [`
${emitSafeTraits()}

#ifndef __TC_SAFE_INT_DEFINED
#define __TC_SAFE_INT_DEFINED

// No #include here: the fixed-width integer types come transitively from
// <Arduino.h> on embedded targets (which pulls <stdint.h>), mirroring the
// other safety polyfills (mode-table, vote). The shared __tc_safe_traits
// block (emitted above) is also header-free.

template <typename T>
struct SafeInt {
  static_assert(__tc_safe_traits::is_integral<T>::value
                && __tc_safe_traits::is_signed<T>::value
                && !__tc_safe_traits::is_same<T, bool>::value,
                "SafeInt<T> requires a signed integer T (int8_t/int16_t/int32_t/int64_t). "
                "Unsigned, bool, floating-point, and non-integer types are rejected.");

private:
  T value_;
  bool fault_;

  static constexpr T kMax = __tc_safe_traits::bounds<T>::kMax;
  static constexpr T kMin = __tc_safe_traits::bounds<T>::kMin;

public:
  // Default constructor: zero-initialized, no fault. Required because promoted
  // top-level variables default-construct via '= {}' before their real
  // initializer is assigned inside the entrypoint. Mirrors SafeVariable's
  // default ctor.
  constexpr SafeInt() noexcept : value_(0), fault_(false) {}
  constexpr SafeInt(T initial) noexcept : value_(initial), fault_(false) {}

  SafeInt<T>& add(T delta) noexcept {
    if (fault_) { return *this; }
    // Pre-check: overflow iff (delta>0 && value>Max-delta) || (delta<0 && value<Min-delta).
    // (Max-delta) and (Min-delta) are safe because delta has the opposite sign
    // of the bound being approached, so the subtraction cannot itself overflow.
    if ((delta > 0 && value_ > kMax - delta) || (delta < 0 && value_ < kMin - delta)) {
      fault_ = true;
      return *this;
    }
    value_ = static_cast<T>(value_ + delta);
    return *this;
  }

  SafeInt<T>& sub(T delta) noexcept {
    if (fault_) { return *this; }
    // Direct pre-check (NOT add(-delta), since -delta is UB when delta==Min):
    //   value - delta > Max  iff  value > Max + delta   (when delta < 0)
    //   value - delta < Min  iff  value < Min + delta   (when delta > 0)
    // (Max+delta)/(Min+delta) are safe — delta has the opposite sign of the bound.
    if ((delta < 0 && value_ > kMax + delta) || (delta > 0 && value_ < kMin + delta)) {
      fault_ = true;
      return *this;
    }
    value_ = static_cast<T>(value_ - delta);
    return *this;
  }

  SafeInt<T>& mul(T factor) noexcept {
    if (fault_) { return *this; }
    if (factor == 0 || value_ == 0) { value_ = 0; return *this; }
    // Pre-check via absolute bounds. |value| > Max / |factor|  => overflow.
    // (Also catches the value==Min && factor==-1 case since |Min| > Max.)
    // absWithoutUB: -(kMin) is UB, so compute |kMin| as -(kMin+1) + (-1) = kMax... no,
    // |kMin| is kMax+1 which is NOT representable. The check absValue > kMax/absFactor
    // still fires for value==kMin because absValue (computed without UB) exceeds any
    // representable positive value when factor==-1. We compute |x| without UB below.
    const T absValue = (value_ < 0) ? static_cast<T>(-(value_ + 1)) + (-1) : value_;
    const T absFactor = (factor < 0) ? static_cast<T>(-(factor + 1)) + (-1) : factor;
    if (absValue > kMax / absFactor) {
      fault_ = true;
      return *this;
    }
    value_ = static_cast<T>(value_ * factor);
    return *this;
  }

  // Named divide (not div) to avoid the cuttlefish reserved-name escaper
  // renaming .div( to .div_( because div() is a C stdlib (<cstdlib>) name.
  SafeInt<T>& divide(T d) noexcept {
    if (fault_) { return *this; }
    if (d == 0) { fault_ = true; return *this; }
    // INT_MIN / -1 overflows.
    if (value_ == kMin && d == static_cast<T>(-1)) { fault_ = true; return *this; }
    value_ = static_cast<T>(value_ / d);
    return *this;
  }

  SafeInt<T>& mod(T d) noexcept {
    if (fault_) { return *this; }
    if (d == 0) { fault_ = true; return *this; }
    if (value_ == kMin && d == static_cast<T>(-1)) { value_ = 0; return *this; }
    value_ = static_cast<T>(value_ % d);
    return *this;
  }

  SafeInt<T>& negate() noexcept {
    if (fault_) { return *this; }
    if (value_ == kMin) { fault_ = true; return *this; }
    value_ = static_cast<T>(-value_);
    return *this;
  }

  // Named absValue (not abs) to avoid colliding with Arduino's abs() macro
  // (Arduino.h #defines abs(x)), which would mangle the method declaration on
  // AVR. Same caution for any future method whose name matches an Arduino core
  // macro (min/max/round/...).
  SafeInt<T>& absValue() noexcept {
    if (fault_) { return *this; }
    if (value_ == kMin) { fault_ = true; return *this; }
    if (value_ < 0) { value_ = static_cast<T>(-value_); }
    return *this;
  }

  [[nodiscard]] constexpr T get() const noexcept { return value_; }
  [[nodiscard]] bool hasFault() const noexcept { return fault_; }
  [[nodiscard]] bool valid() const noexcept { return !fault_; }

  void reset(T newValue) noexcept { value_ = newValue; fault_ = false; }
};

#endif // __TC_SAFE_INT_DEFINED
`.trim()],
    shimMacros: [],
    dependencies: [],
  };
}
