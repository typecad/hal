import type { RuntimePolyfillIR } from "../../api/index.js";

/** Write-then-readback verification. Tree-shaken out unless
 *  __tc_safety_write_verify appears in the program (registered in
 *  POLYFILL_HELPER_MAP).
 *
 *  MCU-agnosticism: writes via the strategy-injected __tc_gpio_write shim,
 *  reads back via __tc_gpio_read — references zero target-specific symbols. */
export function writeVerifyPolyfill(): RuntimePolyfillIR {
  return {
    kind: "polyfill",
    id: "safety_write_verify",
    domain: "embedded",
    requiredIncludes: [],
    forwardDeclarations: [],
    helperStructs: [],
    helperFunctions: [`
// Forward declaration — the strategy's shimLines() defines this AFTER the
// polyfill block (polyfills emit before shims in emitPreamble).
void __tc_gpio_write(uint32_t pin, uint32_t value);
int __tc_gpio_read(uint32_t pin);

namespace __tc_safety {

inline SafeWriteResult write_verify(uint32_t pin, uint32_t value) {
  SafeWriteResult result;
  result.code   = SafetyFaultCode::Ok;
  result.status = SafetyStatus::Ok;

  const TrackedMode mode = get_pin_mode(pin);
  if (mode == TrackedMode::Unknown) {
    result.code   = SafetyFaultCode::PinModeUnknown;
    result.status = SafetyStatus::Fault;
    return result;
  }
  if (mode != TrackedMode::Output) {
    result.code   = SafetyFaultCode::PinModeMismatch;
    result.status = SafetyStatus::Fault;
    return result;
  }

  __tc_gpio_write(pin, (value != 0U) ? 0x1U : 0x0U);

  // Read back the pin to verify the write took effect. On AVR/ESP32
  // Arduino core, digitalRead on an OUTPUT pin returns the last value
  // written to the PORT register, so this check catches software bugs
  // (wrong pin, wrong mode) but not electrical faults (shorted pin,
  // disconnected wire). True electrical verification requires external
  // circuitry routing the output back to a separate input pin.
  const int rd = __tc_gpio_read(pin);
  const uint32_t readback = rd ? 0xFFFFFFFFU : 0x00000000U;
  const uint32_t expected = (value != 0U) ? 0xFFFFFFFFU : 0x00000000U;

  if (readback == expected) {
    result.status = SafetyStatus::Ok;
    result.code   = SafetyFaultCode::Ok;
  } else {
    result.status = SafetyStatus::Fault;
    result.code   = SafetyFaultCode::WriteMismatch;
  }
  return result;
}

}  // namespace __tc_safety

inline SafeWriteResult __tc_safety_write_verify(uint32_t pin, uint32_t value) {
  return __tc_safety::write_verify(pin, value);
}
`.trim()],
    shimMacros: [],
    dependencies: ["safety_mode_table"],
  };
}
