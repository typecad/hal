// Public API surface for @typecad/safety.
//
// `safe` is a COMPILE-TIME CONSTRUCT ONLY. The cuttlefish transpiler
// intercepts safe.read / safe.pinMode calls (via tryResolveSemanticCall →
// the safety hook's resolveSemanticCall) and lowers them to HAL ops. The
// runtime stubs below throw so importing `safe` from plain Node never
// silently works — mirrors how @typecad/ui's ui.mount behaves.

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

/** Safe GPIO read: confirms pin is INPUT, performs a 2-of-3 vote, returns
 *  a SafeReadResult carrying any detected fault. */
export const safe = {
  read(_pin: number): SafeReadResult { throw new CompileTimeOnly(); },
  pinMode(_pin: number, _mode: 0 | 1 | 2): void { throw new CompileTimeOnly(); },
};
