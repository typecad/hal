import type { RuntimePolyfillIR } from "../../api/index.js";
import { emitSafeTraits } from "./safe-traits.js";

/** SafeVariable polyfill: 3-replica TMR with per-replica inversion for
 *  integral types, and plain 3-copy TMR for float/double.
 *
 *  Combines TMR (triple modular redundancy) with inverted-redundancy for
 *  integral types: three replicas of the value, each stored alongside its
 *  bitwise inverse. On read, each replica is individually validated (XOR
 *  check), then the valid replicas are majority-voted. This gives both
 *  detection AND correction:
 *
 *  - A single-bit SEU in any replica's value or inverse breaks that
 *    replica's XOR invariant → the corrupted replica is excluded from
 *    the vote, and the good replicas correct it.
 *  - If two replicas agree (majority), the value is returned with
 *    confidence. The corrupted replica is silently repaired on the next
 *    set().
 *  - For float/double, replicas are stored as plain copies (no inversion
 *    possible), and majority vote still corrects single-replica corruption.
 *
 *  Fault signaling: hasFault() returns true iff the last get() found ZERO
 *  valid replicas (triple corruption). Callers should check hasFault() after
 *  get() on safety-critical paths. set() clears the fault flag.
 *
 *  Memory cost: 3× T (same as plain TMR). The inversion is per-replica and
 *  does not add copies beyond the three TMR replicas.
 *
 *  Arithmetic T only — a static_assert rejects non-arithmetic types (notably
 *  std::string) and bool (for which bitwise inversion is ill-defined) at
 *  compile time. float and double have explicit specializations.
 *
 *  AUTOSAR C++14 compliance:
 *  - noexcept on all methods (A15-0-2)
 *  - [[nodiscard]] on get/valid/hasFault (A0-1-1)
 *  - constexpr constructors/methods
 *  - no malloc/new (A18-5-8/A18-5-10)
 *  - no C-style casts (M5-0-7)
 *  - fixed-width types via template parameter (A3-9-1)
 */
export function safeVariablePolyfill(): RuntimePolyfillIR {
  return {
    kind: "polyfill",
    id: "safety_safe_variable",
    domain: "embedded",
    requiredIncludes: [],
    forwardDeclarations: [],
    helperStructs: [],
    helperFunctions: [`
${emitSafeTraits()}

#ifndef __TC_SAFE_VARIABLE_DEFINED
#define __TC_SAFE_VARIABLE_DEFINED

// ── SafeVariable: integer types (bitwise XOR validation per replica) ──
// Each replica stores value + ~value. On read, each replica is validated
// independently. Valid replicas are majority-voted; the corrupted one
// (if any) is excluded. This provides both detection AND correction.
template <typename T>
struct SafeVariable {
  // Arithmetic T only. bool is rejected explicitly because ~bool and ^bool
  // undergo integer promotion and do not behave as a 1-bit inversion.
  // float/double are handled by the explicit specializations below.
  static_assert(__tc_safe_traits::is_integral<T>::value && !__tc_safe_traits::is_same<T, bool>::value,
                "SafeVariable<T> requires an integral T (use float/double specializations for those; "
                "std::string and bool are not supported)");

private:
  T replicaA_val;
  T replicaA_inv;
  T replicaB_val;
  T replicaB_inv;
  T replicaC_val;
  T replicaC_inv;
  // mutable: get() is logically const (it does not change the stored value)
  // but caches the "last read saw triple corruption" fault flag so callers
  // can inspect it via hasFault() after get().
  mutable bool fault_;
  template <typename U> friend struct SafeVariable;

  static bool replicaValid(T val, T inv) noexcept {
    return (val ^ inv) == static_cast<T>(~static_cast<T>(0));
  }

public:
  SafeVariable() noexcept
      : replicaA_val(0), replicaA_inv(static_cast<T>(~static_cast<T>(0))),
        replicaB_val(0), replicaB_inv(static_cast<T>(~static_cast<T>(0))),
        replicaC_val(0), replicaC_inv(static_cast<T>(~static_cast<T>(0))),
        fault_(false) {}

  SafeVariable(T initial) noexcept
      : replicaA_val(initial), replicaA_inv(static_cast<T>(~initial)),
        replicaB_val(initial), replicaB_inv(static_cast<T>(~initial)),
        replicaC_val(initial), replicaC_inv(static_cast<T>(~initial)),
        fault_(false) {}

  template <typename U>
  SafeVariable(const SafeVariable<U>& other) noexcept
      : replicaA_val(static_cast<T>(other.replicaA_val)), replicaA_inv(static_cast<T>(other.replicaA_inv)),
        replicaB_val(static_cast<T>(other.replicaB_val)), replicaB_inv(static_cast<T>(other.replicaB_inv)),
        replicaC_val(static_cast<T>(other.replicaC_val)), replicaC_inv(static_cast<T>(other.replicaC_inv)),
        fault_(other.fault_) {}

  // Majority vote: returns the agreed-upon value from valid replicas.
  // If a replica is corrupted (XOR check fails), it is excluded from
  // the vote. If two or more valid replicas agree, return that value.
  // If only one replica is valid, return it as a best-effort fallback.
  // If NO replica is valid (triple corruption), returns replicaC_val as a
  // last resort and sets the fault flag — callers must check hasFault().
  [[nodiscard]] T get() const noexcept {
    const bool aValid = replicaValid(replicaA_val, replicaA_inv);
    const bool bValid = replicaValid(replicaB_val, replicaB_inv);
    const bool cValid = replicaValid(replicaC_val, replicaC_inv);

    // Two valid replicas agree → majority.
    if (aValid && bValid && (replicaA_val == replicaB_val)) { fault_ = false; return replicaA_val; }
    if (aValid && cValid && (replicaA_val == replicaC_val)) { fault_ = false; return replicaA_val; }
    if (bValid && cValid && (replicaB_val == replicaC_val)) { fault_ = false; return replicaB_val; }

    // Only one valid replica → return it (no majority but best available).
    if (aValid) { fault_ = false; return replicaA_val; }
    if (bValid) { fault_ = false; return replicaB_val; }
    if (cValid) { fault_ = false; return replicaC_val; }

    // Zero valid replicas → triple corruption. Flag the fault and return
    // replicaC_val as a degenerate fallback; callers MUST check hasFault().
    fault_ = true;
    return replicaC_val;
  }

  // Returns true if all three replicas pass their XOR checks AND agree.
  // Does not mutate the fault flag (it reflects the last get(), not valid()).
  [[nodiscard]] bool valid() const noexcept {
    return replicaValid(replicaA_val, replicaA_inv)
        && replicaValid(replicaB_val, replicaB_inv)
        && replicaValid(replicaC_val, replicaC_inv)
        && (replicaA_val == replicaB_val)
        && (replicaB_val == replicaC_val);
  }

  // Returns true iff the most recent get() found zero valid replicas
  // (triple corruption). Cleared by set() and by a subsequent get() that
  // finds at least one valid replica.
  [[nodiscard]] bool hasFault() const noexcept { return fault_; }

  void set(T newValue) noexcept {
    const T inv = static_cast<T>(~newValue);
    replicaA_val = newValue; replicaA_inv = inv;
    replicaB_val = newValue; replicaB_inv = inv;
    replicaC_val = newValue; replicaC_inv = inv;
    fault_ = false;
  }
};

// ── SafeVariable: float (3-replica majority vote, no inversion) ──
// Floats can't use bitwise XOR/inversion. Three identical copies are
// stored and majority-voted. A single corrupted copy is outvoted and
// silently repaired on the next set().
template <>
struct SafeVariable<float> {
private:
  float replicaA;
  float replicaB;
  float replicaC;
  mutable bool fault_;
  template <typename U> friend struct SafeVariable;
public:
  SafeVariable() noexcept : replicaA(0.0f), replicaB(0.0f), replicaC(0.0f), fault_(false) {}
  SafeVariable(float initial) noexcept : replicaA(initial), replicaB(initial), replicaC(initial), fault_(false) {}
  [[nodiscard]] float get() const noexcept {
    if (replicaA == replicaB) { fault_ = false; return replicaA; }
    if (replicaA == replicaC) { fault_ = false; return replicaA; }
    if (replicaB == replicaC) { fault_ = false; return replicaB; }
    // No two replicas agree — triple corruption.
    fault_ = true;
    return replicaC;
  }
  [[nodiscard]] bool valid() const noexcept {
    return (replicaA == replicaB) && (replicaB == replicaC);
  }
  [[nodiscard]] bool hasFault() const noexcept { return fault_; }
  void set(float newValue) noexcept {
    replicaA = newValue;
    replicaB = newValue;
    replicaC = newValue;
    fault_ = false;
  }
};

// ── SafeVariable: double (3-replica majority vote, no inversion) ──
template <>
struct SafeVariable<double> {
private:
  double replicaA;
  double replicaB;
  double replicaC;
  mutable bool fault_;
  template <typename U> friend struct SafeVariable;
public:
  SafeVariable() noexcept : replicaA(0.0), replicaB(0.0), replicaC(0.0), fault_(false) {}
  SafeVariable(double initial) noexcept : replicaA(initial), replicaB(initial), replicaC(initial), fault_(false) {}
  [[nodiscard]] double get() const noexcept {
    if (replicaA == replicaB) { fault_ = false; return replicaA; }
    if (replicaA == replicaC) { fault_ = false; return replicaA; }
    if (replicaB == replicaC) { fault_ = false; return replicaB; }
    // No two replicas agree — triple corruption.
    fault_ = true;
    return replicaC;
  }
  [[nodiscard]] bool valid() const noexcept {
    return (replicaA == replicaB) && (replicaB == replicaC);
  }
  [[nodiscard]] bool hasFault() const noexcept { return fault_; }
  void set(double newValue) noexcept {
    replicaA = newValue;
    replicaB = newValue;
    replicaC = newValue;
    fault_ = false;
  }
};

#endif // __TC_SAFE_VARIABLE_DEFINED
`.trim()],
    shimMacros: [],
    dependencies: [],
  };
}
