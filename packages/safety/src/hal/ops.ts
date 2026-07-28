// Safety HAL op definitions. These are dispatched by their `operation` string
// prefix ("safety.*") via routeHALOp() in cuttlefish core. The strategy layer
// NEVER resolves them — they are resolved by the safety package's
// resolveSafetyOp, which is MCU-agnostic (it emits calls only to the safety
// package's own __tc_safety_* helpers and the strategy-injected
// __tc_gpio_read shim — never to target-specific symbols like digitalRead).

/** 5-value pin mode, mapped from gpio.set_mode's string field at IR time.
 *  Numeric so the C++ table is 1 byte/pin and the voter switches on enum
 *  values (no strcmp at runtime). Matches the C++ enum class TrackedMode
 *  in runtime/mode-table.ts. */
export enum TrackedMode {
  Unknown       = 0,
  Input         = 1,
  Output        = 2,
  InputPullup   = 3,
  InputPulldown = 4,
}

/** Map a gpio.set_mode mode string (uppercase Arduino macro form, as inlined
 *  by the HAL Pin class bodies in packages/hal/src/gpio.ts) to the TrackedMode
 *  enum. Used by the intercept pass at IR time. Unknown strings map to
 *  TrackedMode.Unknown (defensive — should not happen with the current HAL). */
export function mapModeString(mode: string): TrackedMode {
  switch (mode) {
    case "INPUT":          return TrackedMode.Input;
    case "OUTPUT":         return TrackedMode.Output;
    case "INPUT_PULLUP":   return TrackedMode.InputPullup;
    case "INPUT_PULLDOWN": return TrackedMode.InputPulldown;
    default:               return TrackedMode.Unknown;
  }
}

/** Companion op injected after every gpio.set_mode by the pinMode-intercept
 *  pass. Records the mode in the runtime safety mode table. */
export interface SafetyRecordPinModeOp {
  operation: "safety.record_pin_mode";
  pin: number;
  /** TrackedMode enum value (numeric) — mapped at IR time from the
   *  gpio.set_mode op's mode string. */
  mode: TrackedMode;
}

/** Op produced by `safe.read(Pin)`. Resolves to a C++ expression returning
 *  a SafeReadResult. The pin number is resolved at IR time from the Pin
 *  instance via the halInstances registry. */
export interface SafetyReadSafeOp {
  operation: "safety.read_safe";
  pin: number;
}

export type SafetyHALOp =
  | SafetyRecordPinModeOp
  | SafetyReadSafeOp;
