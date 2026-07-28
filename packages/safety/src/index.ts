// Public API surface for @typecad/safety.
//
// `safe` is a COMPILE-TIME CONSTRUCT ONLY. The cuttlefish transpiler
// intercepts safe.read calls (via tryResolveSemanticCall → the safety hook's
// resolveSemanticCall) and lowers them to safety.read_safe HAL ops. The
// runtime stub below throws so importing `safe` from plain Node never
// silently works — mirrors how @typecad/ui's ui.mount behaves.
//
// Part A v2: mode configuration belongs to @typecad/hal (Pin.asInput() etc.).
// The safety package owns only the verified read.

import type { Pin } from "@typecad/hal";

/** Two-tier fault taxonomy. Stable across safety standards (ISO 26262,
 *  IEC 61508, DO-178C). The category is the coarse user-space routing axis;
 *  the code is standard-specific detail. */
export const SafetyFaultCategory = {
  Ok: 0, Signal: 1, Integrity: 2, Timing: 3, System: 4, Configuration: 5,
} as const;
export type SafetyFaultCategory = typeof SafetyFaultCategory[keyof typeof SafetyFaultCategory];

export const SafetyFaultCode = {
  Ok: 0,
  VoteDisagreement: 1,
  StuckHigh: 2,
  StuckLow: 3,
  PinModeMismatch: 16,
  PinModeUnknown: 17,
} as const;
export type SafetyFaultCode = typeof SafetyFaultCode[keyof typeof SafetyFaultCode];

export interface SafeReadResult {
  readonly ok: boolean;
  readonly value: 0 | 1;
  readonly category: SafetyFaultCategory;
  readonly code: SafetyFaultCode;
}

class CompileTimeOnly extends Error {
  constructor() {
    super("@typecad/safety: `safe` is a compile-time construct. It is lowered by the cuttlefish transpiler and has no runtime implementation.");
  }
}

/** Safe GPIO API. Compile-time construct only — the cuttlefish transpiler
 *  intercepts safe.read and lowers it to a safety.read_safe HAL op. The
 *  type annotation (rather than `as const`) gives `safe` a single object
 *  type so member access doesn't lower to std::variant access — same reason
 *  @typecad/ui's `ui` uses an explicit type annotation. */
export const safe: {
  /** Safe digital read: confirms the pin's recorded mode is INPUT or
   *  INPUT_PULLUP (via the auto-populated mode table), performs a 2-of-3
   *  vote via the strategy-injected __tc_gpio_read shim, returns a
   *  SafeReadResult carrying any detected fault. Accepts any Pin-derived
   *  instance (Pin, InputPin, OutputPin — they are the same runtime
   *  object, re-typed). The pin number is resolved at IR time from the
   *  Pin instance via the halInstances registry. */
  read(pin: Pin): SafeReadResult;
} = {
  read(_pin: Pin): SafeReadResult { throw new CompileTimeOnly(); },
};
