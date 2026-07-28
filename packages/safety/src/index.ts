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

export { SafeVariable } from "./safe-variable-types.js";

import type { Pin, InputPin, OutputPin } from "@typecad/hal";

/** Any pin-shaped argument safe.read accepts. Named type (rather than
 *  `Pin | InputPin | OutputPin` inline) so the safety API's stringified
 *  type doesn't contain " | ", which would trip the TS2CPP_UNION_MEMBER_ACCESS
 *  semantic gate at the call site. At runtime these three classes share
 *  the same `_pin: number` field — the safety package resolves it via the
 *  halInstances registry at IR time. */
export type AnyPin = Pin | InputPin | OutputPin;

/** Two-tier fault taxonomy. Stable across safety standards (ISO 26262,
 *  IEC 61508, DO-178C). The category is the coarse user-space routing axis;
 *  the code is standard-specific detail.
 *
 *  Declared as TypeScript `enum` (not `const` object + type alias) so the
 *  cuttlefish transpiler lowers these to a single C++ `enum class` definition
 *  matching the runtime polyfill's enum, rather than emitting a conflicting
 *  struct per usage scope. The transpiler's enum lowering and the polyfill's
 *  enum class are structurally identical (same tag name, same enumerators,
 *  same values). */
export enum SafetyFaultCategory {
  Ok            = 0,
  Signal        = 1,
  Integrity     = 2,
  Timing        = 3,
  System        = 4,
  Configuration = 5,
}

export enum SafetyFaultCode {
  Ok               = 0,
  VoteDisagreement = 1,
  StuckHigh        = 2,
  StuckLow         = 3,
  PinModeMismatch  = 16,
  PinModeUnknown   = 17,
}

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
   *  SafeReadResult carrying any detected fault.
   *
   *  Accepts Pin, InputPin, or OutputPin — at runtime they are the same
   *  object (Pin.asInput() returns `this as unknown as InputPin`, a
   *  re-typed reference to the same Pin). The runtime mode-table check
   *  rejects pins configured as OUTPUT (returns PinModeMismatch), so
   *  passing an OutputPin is technically allowed but always faults. */
  read(pin: AnyPin): SafeReadResult;
} = {
  read(_pin: AnyPin): SafeReadResult { throw new CompileTimeOnly(); },
};
