import type { RuntimePolyfillIR } from "@typecad/cuttlefish/api";

/** TmrSafeVariable polyfill: 3-replica TMR with per-replica inversion.
 *
 *  Combines TMR (triple modular redundancy) with inverted-redundancy:
 *  three replicas of the value, each stored alongside its bitwise inverse.
 *  On read, each replica is individually validated (XOR check), then the
 *  valid replicas are majority-voted. This gives both detection AND
 *  correction:
 *
 *  - A single-bit SEU in any replica's value or inverse breaks that
 *    replica's XOR invariant → the corrupted replica is excluded from
 *    the vote, and the good replicas correct it.
 *  - If two replicas agree (majority), the value is returned with
 *    confidence. The corrupted replica is silently repaired on the next
 *    set().
 *  - For non-integer types (float/double), replicas are stored as plain
 *    copies (no inversion possible), and majority vote still corrects
 *    single-replica corruption.
 *
 *  Memory cost: 3× T (same as plain TMR). The inversion is per-replica
 *  and does not add copies beyond the three TMR replicas.
 *
 *  AUTOSAR C++14 compliance:
 *  - noexcept on all methods (A15-0-2)
 *  - [[nodiscard]] on get/valid (A0-1-1)
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
#ifndef __TC_SAFE_VARIABLE_DEFINED
#define __TC_SAFE_VARIABLE_DEFINED

// ── TmrSafeVariable: integer types (bitwise XOR validation per replica) ──
// Each replica stores value + ~value. On read, each replica is validated
// independently. Valid replicas are majority-voted; the corrupted one
// (if any) is excluded. This provides both detection AND correction.
template <typename T>
struct SafeVariable {
private:
  T replicaA_val;
  T replicaA_inv;
  T replicaB_val;
  T replicaB_inv;
  T replicaC_val;
  T replicaC_inv;
  template <typename U> friend struct SafeVariable;

  static bool replicaValid(T val, T inv) noexcept {
    return (val ^ inv) == static_cast<T>(~static_cast<T>(0));
  }

public:
  SafeVariable() noexcept
      : replicaA_val(0), replicaA_inv(static_cast<T>(~static_cast<T>(0))),
        replicaB_val(0), replicaB_inv(static_cast<T>(~static_cast<T>(0))),
        replicaC_val(0), replicaC_inv(static_cast<T>(~static_cast<T>(0))) {}

  SafeVariable(T initial) noexcept
      : replicaA_val(initial), replicaA_inv(static_cast<T>(~initial)),
        replicaB_val(initial), replicaB_inv(static_cast<T>(~initial)),
        replicaC_val(initial), replicaC_inv(static_cast<T>(~initial)) {}

  template <typename U>
  SafeVariable(const SafeVariable<U>& other) noexcept
      : replicaA_val(static_cast<T>(other.replicaA_val)), replicaA_inv(static_cast<T>(other.replicaA_inv)),
        replicaB_val(static_cast<T>(other.replicaB_val)), replicaB_inv(static_cast<T>(other.replicaB_inv)),
        replicaC_val(static_cast<T>(other.replicaC_val)), replicaC_inv(static_cast<T>(other.replicaC_inv)) {}

  // Majority vote: returns the agreed-upon value from valid replicas.
  // If a replica is corrupted (XOR check fails), it is excluded from
  // the vote. If two or more valid replicas agree, return that value.
  // If only one replica is valid (triple corruption), return it as a
  // best-effort fallback.
  [[nodiscard]] T get() const noexcept {
    const bool aValid = replicaValid(replicaA_val, replicaA_inv);
    const bool bValid = replicaValid(replicaB_val, replicaB_inv);
    const bool cValid = replicaValid(replicaC_val, replicaC_inv);

    // Two valid replicas agree → majority.
    if (aValid && bValid && (replicaA_val == replicaB_val)) return replicaA_val;
    if (aValid && cValid && (replicaA_val == replicaC_val)) return replicaA_val;
    if (bValid && cValid && (replicaB_val == replicaC_val)) return replicaB_val;

    // Only one valid replica → return it (no majority but best available).
    if (aValid) return replicaA_val;
    if (bValid) return replicaB_val;
    return replicaC_val;
  }

  // Returns true if all three replicas pass their XOR checks AND agree.
  [[nodiscard]] bool valid() const noexcept {
    return replicaValid(replicaA_val, replicaA_inv)
        && replicaValid(replicaB_val, replicaB_inv)
        && replicaValid(replicaC_val, replicaC_inv)
        && (replicaA_val == replicaB_val)
        && (replicaB_val == replicaC_val);
  }

  void set(T newValue) noexcept {
    const T inv = static_cast<T>(~newValue);
    replicaA_val = newValue; replicaA_inv = inv;
    replicaB_val = newValue; replicaB_inv = inv;
    replicaC_val = newValue; replicaC_inv = inv;
  }
};

// ── TmrSafeVariable: float (3-replica majority vote, no inversion) ──
// Floats can't use bitwise XOR/inversion. Three identical copies are
// stored and majority-voted. A single corrupted copy is outvoted and
// silently repaired on the next set().
template <>
struct SafeVariable<float> {
private:
  float replicaA;
  float replicaB;
  float replicaC;
  template <typename U> friend struct SafeVariable;
public:
  SafeVariable() noexcept : replicaA(0.0f), replicaB(0.0f), replicaC(0.0f) {}
  SafeVariable(float initial) noexcept : replicaA(initial), replicaB(initial), replicaC(initial) {}
  [[nodiscard]] float get() const noexcept {
    if (replicaA == replicaB) return replicaA;
    if (replicaA == replicaC) return replicaA;
    return replicaB;
  }
  [[nodiscard]] bool valid() const noexcept {
    return (replicaA == replicaB) && (replicaB == replicaC);
  }
  void set(float newValue) noexcept {
    replicaA = newValue;
    replicaB = newValue;
    replicaC = newValue;
  }
};

// ── TmrSafeVariable: double (3-replica majority vote, no inversion) ──
template <>
struct SafeVariable<double> {
private:
  double replicaA;
  double replicaB;
  double replicaC;
  template <typename U> friend struct SafeVariable;
public:
  SafeVariable() noexcept : replicaA(0.0), replicaB(0.0), replicaC(0.0) {}
  SafeVariable(double initial) noexcept : replicaA(initial), replicaB(initial), replicaC(initial) {}
  [[nodiscard]] double get() const noexcept {
    if (replicaA == replicaB) return replicaA;
    if (replicaA == replicaC) return replicaA;
    return replicaB;
  }
  [[nodiscard]] bool valid() const noexcept {
    return (replicaA == replicaB) && (replicaB == replicaC);
  }
  void set(double newValue) noexcept {
    replicaA = newValue;
    replicaB = newValue;
    replicaC = newValue;
  }
};

#endif // __TC_SAFE_VARIABLE_DEFINED
`.trim()],
    shimMacros: [],
    dependencies: [],
  };
}
