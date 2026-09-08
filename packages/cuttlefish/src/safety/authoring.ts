// Public API surface for cuttlefish safety — importable as
// '@typecad/cuttlefish/safety' (the legacy '@typecad/safety' specifier is
// still detected by the transpiler; detection is by name, no module
// resolution happens).
//
// `safe` is a COMPILE-TIME CONSTRUCT ONLY. The cuttlefish transpiler
// intercepts safe.read calls (via tryResolveSemanticCall → the safety hook's
// resolveSemanticCall) and lowers them to safety.read_safe HAL ops. The
// runtime stub below throws so importing `safe` from plain Node never
// silently works — mirrors how @typecad/ui's ui.mount behaves.
//
// Part A v2: mode configuration belongs to @typecad/hal (Pin.asInput() etc.).
// The safety engine owns only the verified read.

export type { SafeVariable } from "./safe-variable-types.js";
export type { SafeInt } from "./safe-int-types.js";

import type { Pin } from "@typecad/hal";

/** The pin argument safe.read accepts — a thin-HAL `GPIO`. A named alias so
 *  the safety API's stringified type stays free of union syntax at call sites.
 *  At runtime the safety package resolves the same `_pin: number` field via
 *  the halInstances registry at IR time. */
export type AnyPin = Pin;

/** Two-tier fault taxonomy. Stable across safety standards (ISO 26262,
 *  IEC 61508, DO-178C). The category is the coarse user-space routing axis;
 *  the code is standard-specific detail.
 *
 *  Declared as TypeScript `enum` (not `const` object + type alias) so the
 *  typecad-hal transpiler lowers these to a single C++ `enum class` definition
 *  matching the runtime polyfill's enum, rather than emitting a conflicting
 *  struct per usage scope. The transpiler's enum lowering and the polyfill's
 *  enum class are structurally identical (same tag name, same enumerators,
 *  same values). */
export enum SafetyFaultCategory {
  Ok            = 0x3C3C3C3C,
  Signal        = 0x5A5A5A5A,
  Integrity     = 0xA5A5A5A5,
  Timing        = 0xC3C3C3C3,
  System        = 0x55AA55AA,
  Configuration = 0xAA55AA55,
}

export enum SafetyFaultCode {
  Ok               = 0x3C3C3C3C,
  VoteDisagreement = 0x5A5A5A5A,
  StuckHigh        = 0xA5A5A5A5,
  StuckLow         = 0xC3C3C3C3,
  PinModeMismatch  = 0x55AA55AA,
  PinModeUnknown   = 0xAA55AA55,
  WriteMismatch    = 0x3C5AA5C3,
}

export enum SafetyStatus {
  Ok    = 0x5A5A5A5A,
  Fault = 0xA5A5A5A5,
}

export interface SafeReadResult {
  readonly status: SafetyStatus;
  readonly value: number;
  readonly category: SafetyFaultCategory;
  readonly code: SafetyFaultCode;
  /** Run handler iff status === Ok. Handler receives the full result. Returns the result (chainable). */
  ok(handler: (r: SafeReadResult) => void): SafeReadResult;
  /** Run handler iff status !== Ok. Handler receives the full result. Returns the result (chainable). */
  fail(handler: (r: SafeReadResult) => void): SafeReadResult;
  /** Alias of fail(). */
  fault(handler: (r: SafeReadResult) => void): SafeReadResult;
  /** Run handler unconditionally. Returns the result (chainable). */
  always(handler: (r: SafeReadResult) => void): SafeReadResult;
}

export interface SafeWriteResult {
  readonly status: SafetyStatus;
  readonly code: SafetyFaultCode;
  ok(handler: (r: SafeWriteResult) => void): SafeWriteResult;
  fail(handler: (r: SafeWriteResult) => void): SafeWriteResult;
  fault(handler: (r: SafeWriteResult) => void): SafeWriteResult;
  always(handler: (r: SafeWriteResult) => void): SafeWriteResult;
}

class CompileTimeOnly extends Error {
  constructor() {
    super("cuttlefish safety: `safe` is a compile-time construct. It is lowered by the typecad-hal transpiler and has no runtime implementation.");
  }
}

/** Safe GPIO API. Compile-time construct only — the typecad-hal transpiler
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
   *  Accepts any thin-HAL GPIO regardless of its constructed flag set. The
   *  runtime mode-table check (driven by the GPIO's construction flags)
   *  rejects pins configured as OUTPUT (returns PinModeMismatch). */
  read(pin: AnyPin): SafeReadResult;

  /** Safe digital write with readback verification. Writes the value,
   *  immediately reads the physical pin state back, and returns a
   *  SafeWriteResult confirming the write succeeded or flagging a fault.
   *
   *  Verifies the pin's recorded mode is OUTPUT (returns PinModeMismatch
   *  for non-output pins). On write/read mismatch, returns
   *  WriteMismatch. */
  write(pin: Pin, value: number): SafeWriteResult;
} = {
  read(_pin: AnyPin): SafeReadResult { throw new CompileTimeOnly(); },
  write(_pin: Pin, _value: number): SafeWriteResult { throw new CompileTimeOnly(); },
};
