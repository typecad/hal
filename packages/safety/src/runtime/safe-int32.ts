import type { RuntimePolyfillIR } from "@typecad/cuttlefish/api";

/** Bounds-checked int32_t arithmetic with overflow/underflow detection.
 *  Tree-shaken out unless SafeInt32 appears in a type annotation or a
 *  SafeInt32(n) constructor call is used in the program. */
export function safeInt32Polyfill(): RuntimePolyfillIR {
  return {
    kind: "polyfill",
    id: "safety_safe_int32",
    domain: "embedded",
    requiredIncludes: [],
    forwardDeclarations: [],
    helperStructs: [],
    helperFunctions: [`
#ifndef __TC_SAFE_INT32_DEFINED
#define __TC_SAFE_INT32_DEFINED

struct SafeInt32 {
private:
  int32_t value_;
  bool fault_;

  static constexpr int32_t kMax = static_cast<int32_t>(0x7FFFFFFF);
  static constexpr int32_t kMin = static_cast<int32_t>(-2147483647 - 1);

public:
  SafeInt32() : value_(0), fault_(false) {}
  explicit SafeInt32(int32_t v) : value_(v), fault_(false) {}

  [[nodiscard]] int32_t get() const noexcept { return value_; }
  void set(int32_t v) noexcept { value_ = v; fault_ = false; }
  [[nodiscard]] bool hasFault() const noexcept { return fault_; }

  [[nodiscard]] SafeInt32 safeAdd(int32_t delta) const noexcept {
    if (fault_) {
      return *this;
    }
    if ((delta > 0) && (value_ > (kMax - delta))) {
      SafeInt32 result;
      result.value_ = kMax;
      result.fault_ = true;
      return result;
    }
    if ((delta < 0) && (value_ < (kMin - delta))) {
      SafeInt32 result;
      result.value_ = kMin;
      result.fault_ = true;
      return result;
    }
    return SafeInt32(value_ + delta);
  }

  [[nodiscard]] SafeInt32 safeSub(int32_t delta) const noexcept {
    if ((delta == kMin) && (value_ > 0)) {
      SafeInt32 result;
      result.value_ = kMin;
      result.fault_ = true;
      return result;
    }
    if (delta == kMin) {
      return safeAdd(static_cast<int32_t>(-(static_cast<int64_t>(kMin))));
    }
    return safeAdd(static_cast<int32_t>(-delta));
  }

  [[nodiscard]] SafeInt32 safeMul(int32_t factor) const noexcept {
    if (fault_) {
      return *this;
    }
    if ((value_ == 0) || (factor == 0)) {
      return SafeInt32(0);
    }
    if ((value_ == kMin) && (factor == -1)) {
      SafeInt32 result;
      result.value_ = kMax;
      result.fault_ = true;
      return result;
    }
    const int64_t product = static_cast<int64_t>(value_) * static_cast<int64_t>(factor);
    if (product > static_cast<int64_t>(kMax)) {
      SafeInt32 result;
      result.value_ = kMax;
      result.fault_ = true;
      return result;
    }
    if (product < static_cast<int64_t>(kMin)) {
      SafeInt32 result;
      result.value_ = kMin;
      result.fault_ = true;
      return result;
    }
    return SafeInt32(static_cast<int32_t>(product));
  }

  [[nodiscard]] SafeInt32 safeDiv(int32_t divisor) const noexcept {
    if (fault_) {
      return *this;
    }
    if (divisor == 0) {
      SafeInt32 result;
      result.value_ = (value_ >= 0) ? kMax : kMin;
      result.fault_ = true;
      return result;
    }
    if ((value_ == kMin) && (divisor == -1)) {
      SafeInt32 result;
      result.value_ = kMax;
      result.fault_ = true;
      return result;
    }
    return SafeInt32(value_ / divisor);
  }
};

#endif // __TC_SAFE_INT32_DEFINED
`.trim()],
    shimMacros: [],
    dependencies: [],
  };
}
