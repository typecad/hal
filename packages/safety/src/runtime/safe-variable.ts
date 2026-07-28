import type { RuntimePolyfillIR } from "@typecad/cuttlefish/api";

/** SafeVariable polyfill: inverted-redundancy dual-copy storage.
 *
 *  Stores a value alongside its bitwise inverse (~value). On every read,
 *  XORs the two copies: if they're not exact inverses, RAM corruption
 *  has occurred and the read reports a fault.
 *
 *  SEU resistance:
 *  - Single-bit flip in either copy breaks the XOR invariant → detected.
 *  - Multi-bit flip that changes value without matching the inverse → detected.
 *  - The two copies are stored at different struct-field addresses, so a
 *    single particle strike hitting both is extremely unlikely.
 *
 *  AUTOSAR C++14 compliance:
 *  - noexcept on all methods (A15-0-2)
 *  - [[nodiscard]] on read (A0-1-1: result must not be discarded)
 *  - constexpr constructors/methods (compile-time evaluatable)
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
template <typename T>
struct SafeVariable {
private:
  T value;
  T inverted;

public:
  constexpr SafeVariable() noexcept : value(T{}), inverted(static_cast<T>(~T{})) {}
  constexpr SafeVariable(T initial) noexcept
      : value(initial), inverted(static_cast<T>(~initial)) {}

  [[nodiscard]] constexpr T get() const noexcept {
    if ((value ^ inverted) == static_cast<T>(~static_cast<T>(0))) {
      return value;
    }
    return T{};
  }

  [[nodiscard]] constexpr bool valid() const noexcept {
    return (value ^ inverted) == static_cast<T>(~static_cast<T>(0));
  }

  constexpr void set(T newValue) noexcept {
    value = newValue;
    inverted = static_cast<T>(~newValue);
  }
};

// The tree-shaker keeps helperFunctions whose extracted __tc_ names appear in
// the program's used-helpers set, OR whose extractHelperFunctionNames returns
// empty (non-__tc_ code is always kept). Since SafeVariable<T> is a type
// annotation (not a call expression), the tree-shaker can't detect it at IR
// time. The template is always emitted when @typecad/safety is active — it's
// a small definition and the safety package is opt-in.
`.trim()],
    shimMacros: [],
    dependencies: [],
  };
}
