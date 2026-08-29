import type { RuntimePolyfillIR } from "../../api/index.js";
import { emitResultStructs } from "./result-struct.js";

/** The pin-mode tracking table + accessors. Tree-shaken out unless
 *  __tc_safety_record_pin_mode appears in the program (registered in
 *  POLYFILL_HELPER_MAP). */
export function modeTablePolyfill(): RuntimePolyfillIR {
  return {
    kind: "polyfill",
    id: "safety_mode_table",
    domain: "embedded",
    requiredIncludes: [],
    forwardDeclarations: [],
    helperStructs: [],
    helperFunctions: [
      emitResultStructs(),
      `
namespace __tc_safety {
constexpr uint32_t TC_SAFETY_PIN_TABLE_SIZE = 255U;

enum class TrackedMode : uint32_t {
  Unknown       = 0x00000000U,
  Input         = 0x5A5A5A5AU,
  Output        = 0xA5A5A5A5U,
  InputPullup   = 0x3C3C3C3CU,
  InputPulldown = 0xC3C3C3C3U,
};

// Raw array: unavoidable for O(1) pin-indexed lookup in an embedded shim.
// Zero-initialized namespace-scope static storage (Unknown = 0U) satisfies
// M3-2-1 (const-init) and M3-2-4 (trivial static init); no knownPatterns
// deviation needed (verified in Part A v1).
TrackedMode g_pin_mode_table[TC_SAFETY_PIN_TABLE_SIZE];

inline void record_pin_mode(uint32_t pin, uint32_t mode) {
  if (pin < TC_SAFETY_PIN_TABLE_SIZE) {
    g_pin_mode_table[pin] = static_cast<TrackedMode>(mode);
  }
}

inline TrackedMode get_pin_mode(uint32_t pin) {
  if (pin < TC_SAFETY_PIN_TABLE_SIZE) {
    return g_pin_mode_table[pin];
  }
  return TrackedMode::Unknown;
}
}  // namespace __tc_safety

inline void __tc_safety_record_pin_mode(uint32_t pin, uint32_t mode) {
  __tc_safety::record_pin_mode(pin, mode);
}
`.trim(),
    ],
    shimMacros: [],
    dependencies: [],
  };
}
