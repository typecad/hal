// Safety HAL op definitions. These are dispatched by their `operation` string
// prefix ("safety.*") via routeHALOp() in cuttlefish core. The strategy layer
// NEVER resolves them — they are resolved by the safety package's
// resolveSafetyOp, which is MCU-agnostic (it emits calls to the standard
// Arduino pinMode()/digitalRead() symbols that every strategy already lowers
// correctly for its target).

/** Companion op injected after every gpio.pin_mode / safety.pin_mode by the
 *  pinMode-intercept pass. Records the mode in the runtime safety mode table. */
export interface SafetyRecordPinModeOp {
  operation: "safety.record_pin_mode";
  pin: number;
  /** 0=INPUT, 1=OUTPUT, 2=INPUT_PULLUP (matches Arduino INPUT/OUTPUT/INPUT_PULLUP) */
  mode: 0 | 1 | 2;
}

/** Op produced by `safe.read(pin)`. Resolves to a C++ expression returning
 *  a SafeReadResult. */
export interface SafetyReadSafeOp {
  operation: "safety.read_safe";
  pin: number;
}

/** Op produced by `safe.pinMode(pin, mode)`. Resolves to pinMode() +
 *  record_pin_mode(). The intercept pass ALSO injects a record_pin_mode
 *  companion after this op (uniform treatment with gpio.pin_mode). */
export interface SafetyPinModeOp {
  operation: "safety.pin_mode";
  pin: number;
  mode: 0 | 1 | 2;
}

export type SafetyHALOp =
  | SafetyRecordPinModeOp
  | SafetyReadSafeOp
  | SafetyPinModeOp;

/** Map Arduino mode constants to numeric encoding used by the mode table.
 *  INPUT=0x00, OUTPUT=0x01, INPUT_PULLUP=0x02 on every Arduino core. */
export function modeConstant(mode: 0 | 1 | 2): string {
  switch (mode) {
    case 0: return "INPUT";
    case 1: return "OUTPUT";
    case 2: return "INPUT_PULLUP";
  }
}
