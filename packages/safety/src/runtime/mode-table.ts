import type { RuntimePolyfillIR } from "@typecad/cuttlefish/api";
import { emitResultStructs } from "./result-struct.js";

/** The pin-mode tracking table + accessors. Tree-shaken out unless
 *  __tc_safety::record_pin_mode appears in the program (registered in
 *  POLYFILL_HELPER_MAP). */
export function modeTablePolyfill(): RuntimePolyfillIR {
  return {
    kind: "polyfill",
    id: "safety_mode_table",
    domain: "embedded",
    requiredIncludes: [],
    forwardDeclarations: [],
    helperStructs: [],
    // helperFunctions is what filterPolyfillHelpers scans for __tc_* names.
    // record_pin_mode and get_pin_mode live in the __tc_safety namespace so
    // they are visible to read_safe (same namespace). The result structs are
    // emitted first so the voter can return SafeReadResult.
    helperFunctions: [
      emitResultStructs(),
      `
namespace __tc_safety {
constexpr uint8_t TC_SAFETY_PIN_TABLE_SIZE = 255U;

enum class TrackedMode : uint8_t {
  Unknown     = 0U,
  Input       = 1U,
  Output      = 2U,
  InputPullup = 3U,
};

// Raw array: unavoidable for O(1) pin-indexed lookup in an embedded shim.
// Zero-initialized namespace-scope static storage (TrackedMode::Unknown = 0U)
// satisfies M3-2-1 (const-init) and M3-2-4 (trivial static init); no
// knownPatterns deviation is expected. If a rule fires anyway, add one.
TrackedMode g_pin_mode_table[TC_SAFETY_PIN_TABLE_SIZE];

inline void record_pin_mode(uint8_t pin, uint8_t mode) {
  if (pin < TC_SAFETY_PIN_TABLE_SIZE) {
    switch (mode) {
      case 0U: g_pin_mode_table[pin] = TrackedMode::Input;       break;
      case 1U: g_pin_mode_table[pin] = TrackedMode::Output;      break;
      case 2U: g_pin_mode_table[pin] = TrackedMode::InputPullup; break;
      default: g_pin_mode_table[pin] = TrackedMode::Unknown;     break;
    }
  }
}

inline TrackedMode get_pin_mode(uint8_t pin) {
  if (pin < TC_SAFETY_PIN_TABLE_SIZE) {
    return g_pin_mode_table[pin];
  }
  return TrackedMode::Unknown;
}
}  // namespace __tc_safety
`.trim(),
    ],
    shimMacros: [],
    dependencies: [],
  };
}
