// Safety HAL op definitions. These are dispatched by their `operation` string
// prefix ("safety.*") via routeHALOp() in cuttlefish core. The strategy layer
// NEVER resolves them — they are resolved by the safety package's
// resolveSafetyOp, which is MCU-agnostic (it emits calls only to the safety
// package's own __tc_safety_* helpers and the strategy-injected
// __tc_gpio_read shim — never to target-specific symbols like digitalRead).

/** 5-value pin mode, mapped from gpio.configure's flag tokens at IR time.
 *  Numeric so the voter switches on enum values (no strcmp at runtime). The
 *  values are 32-bit Hamming-distance constants (0x5A5A5A5A etc.) chosen for
 *  SEU resistance — a single-bit flip never lands on another valid mode.
 *  This makes the C++ mode table 4 bytes/pin (~1 KB for the 255-entry table
 *  on AVR, which has 2 KB SRAM). That is a deliberate trade-off vs 1-byte
 *  storage: the SEU resistance is the whole point of the safety package.
 *  Matches the C++ enum class TrackedMode in runtime/mode-table.ts. */
export enum TrackedMode {
  Unknown       = 0x00000000,
  Input         = 0x5A5A5A5A,
  Output        = 0xA5A5A5A5,
  InputPullup   = 0x3C3C3C3C,
  InputPulldown = 0xC3C3C3C3,
}

/** Map gpio.configure flag-token text ("GPIO.INPUT | GPIO.PULL_UP", the
 *  thin GPIO constructor's resolved flags) to the TrackedMode enum. Used by
 *  the intercept pass at IR time. Direction wins over pulls; combos with no
 *  tracked equivalent (open-drain, runtime expressions) map to Unknown so
 *  the table still gets a fresh entry. */
export function mapFlagTokens(flags: string): TrackedMode {
  // Only a pure token list ("GPIO.INPUT | GPIO.PULL_UP") is statically
  // classifiable — anything else (runtime expression) is Unknown.
  if (!/^\s*GPIO\.[A-Z0-9_]+(\s*\|\s*GPIO\.[A-Z0-9_]+)*\s*$/.test(flags)) {
    return TrackedMode.Unknown;
  }
  const output = flags.includes("GPIO.OUTPUT");
  const input = flags.includes("GPIO.INPUT");
  if (output && !input) return TrackedMode.Output;
  if (input || output) {
    if (flags.includes("GPIO.PULL_UP")) return TrackedMode.InputPullup;
    if (flags.includes("GPIO.PULL_DOWN")) return TrackedMode.InputPulldown;
    return TrackedMode.Input;
  }
  return TrackedMode.Unknown;
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

/** Op produced by `safe.write(OutputPin, value)`. Resolves to a C++ expression
 *  returning a SafeWriteResult. The pin number is resolved at IR time from the
 *  Pin instance via the halInstances registry. The value may be a numeric
 *  literal or a string containing the rendered C++ expression text (e.g.
 *  "r.value", "x + 1"). */
export interface SafetyWriteVerifyOp {
  operation: "safety.write_verify";
  pin: number;
  value: number | string;
}

export type SafetyHALOp =
  | SafetyRecordPinModeOp
  | SafetyReadSafeOp
  | SafetyWriteVerifyOp;
