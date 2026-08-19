// ---------------------------------------------------------------------------
// Output Pin State Tracking
//
// Tracks the driven level of pins configured as OUTPUT so that
// OutputPin.read()/isHigh()/isLow() can be answered without a hardware pin
// read. Reading back an OUTPUT-only pin is not portable (Zephyr's
// gpio_pin_get reads the input latch, which is undefined for direction-only
// outputs), so the transpiler instead maintains the state itself:
//
// - When the level is statically known at the read site (asOutput(false)
//   followed by literal high/low/write/toggle calls), the read folds to a
//   compile-time constant.
// - When it is not (runtime-valued writes, loops, branches, function
//   bodies), the read lowers to a shadow variable (`__tc_pin_state_<n>`)
//   that every generated write/toggle on that pin keeps updated.
//
// The tracker is updated in program order during IR lowering (the same pass
// that resolves HAL method bodies), so the state seen at each read site is
// the state at that point in the source. Control-flow joins and loop bodies
// conservatively invalidate levels (see control-flow.ts hooks); function and
// callback bodies disable folding entirely and force the shadow form.
// ---------------------------------------------------------------------------

import type { ProgramIR, HALOpIR } from "../api/index.js";
import { walkProgramIR, walkExpressions } from "./utils/walk-ir.js";

export type TrackedPinLevel = 'high' | 'low' | 'unknown';

/** Pin numbers explicitly configured as OUTPUT via gpio.set_mode. */
const outputPins = new Set<number>();

/** Last driven level per output pin, at the current program point. */
const pinLevels = new Map<number, TrackedPinLevel>();

/** Output pins whose reads lowered to the shadow variable form. */
const shadowPins = new Set<number>();

/** Initializer for each shadow variable: the statically-known level at the
 *  time the first shadow read was resolved, or `false` when unknown. */
const shadowInitial = new Map<number, boolean>();

/** Folding is disabled inside function/callback bodies, where the top-level
 *  program-point state does not apply at runtime. */
let foldingEnabled = true;

/** C++ identifier for a pin's shadow state variable. */
export function pinShadowVarName(pin: number): string {
  return `__tc_pin_state_${pin}`;
}

export function resetPinStateTracking(): void {
  outputPins.clear();
  pinLevels.clear();
  shadowPins.clear();
  shadowInitial.clear();
  foldingEnabled = true;
}

/** Record gpio.set_mode — OUTPUT* modes enable tracking, anything else ends it. */
export function notePinSetMode(pin: number, mode: string | null): void {
  const isOutput = mode !== null && /output/i.test(mode);
  if (isOutput) {
    outputPins.add(pin);
    pinLevels.set(pin, 'unknown');
  } else {
    outputPins.delete(pin);
    pinLevels.delete(pin);
  }
}

/** Record gpio.write — literal values set the level; expressions make it unknown. */
export function notePinWrite(pin: number, literalValue: number | boolean | null): void {
  if (!outputPins.has(pin)) return;
  pinLevels.set(pin, literalValue === null ? 'unknown' : (literalValue ? 'high' : 'low'));
}

/** Record gpio.toggle — inverts a known level, keeps unknown as unknown. */
export function notePinToggle(pin: number): void {
  if (!outputPins.has(pin)) return;
  const level = pinLevels.get(pin);
  if (level === 'high') pinLevels.set(pin, 'low');
  else if (level === 'low') pinLevels.set(pin, 'high');
  else pinLevels.set(pin, 'unknown');
}

/**
 * Record PWM/tone output — the pin no longer has a digital level, so any
 * tracked level goes unknown (reads must not fold to the pre-PWM literal).
 * A later digital write/toggle restores digital tracking.
 */
export function notePinAnalogOutput(pin: number): void {
  if (!outputPins.has(pin)) return;
  pinLevels.set(pin, 'unknown');
}

/**
 * Resolve a read on a pin at the current program point.
 * Returns 'high'/'low' when the level folds to a constant, 'shadow' when a
 * shadow variable must carry it, or null when the pin is not a tracked
 * output pin (unconfigured or input mode → normal hardware read lowering).
 */
export function resolveTrackedRead(pin: number): 'high' | 'low' | 'shadow' | null {
  if (!outputPins.has(pin)) return null;
  const level = pinLevels.get(pin);
  if (foldingEnabled && (level === 'high' || level === 'low')) return level;
  shadowPins.add(pin);
  if (!shadowInitial.has(pin)) shadowInitial.set(pin, level === 'high');
  return 'shadow';
}

/** Whether write/toggle ops on this pin must also update its shadow variable. */
export function isShadowPin(pin: number): boolean {
  return shadowPins.has(pin);
}

/** Consume the shadow declarations owed by this build (pin + initializer).
 *  Clears the shadow set: emit reads the updatesShadow flags baked into the
 *  ops below, never this module's live state (each file's build resets the
 *  tracker, and all files finish building before any emit runs). */
export function takeShadowDeclarations(): { pin: number; initial: boolean }[] {
  const decls = [...shadowPins].sort((a, b) => a - b).map(pin => ({
    pin,
    initial: shadowInitial.get(pin) ?? false,
  }));
  shadowPins.clear();
  shadowInitial.clear();
  return decls;
}

/** Mark every gpio.write / gpio.toggle op in the program whose pin has a
 *  tracked shadow read, so the emitter appends the shadow-variable update.
 *  Runs once at the end of buildProgramIR, after the whole file is lowered —
 *  at that point the shadow set is final, so writes that were lowered BEFORE
 *  the first shadow read are marked too (their ops are already in the IR).
 *  This is what makes emit independent of tracker state across files. */
export function markShadowUpdatingOps(program: ProgramIR): void {
  if (shadowPins.size === 0) return;
  const markOp = (op: unknown): void => {
    const halOp = op as HALOpIR | undefined;
    if (!halOp) return;
    if ((halOp.operation === "gpio.write" || halOp.operation === "gpio.toggle") && isShadowPin(halOp.pin)) {
      halOp.updatesShadow = true;
    }
  };
  walkProgramIR(program, (stmt) => {
    if ((stmt as { kind?: string }).kind === "hal-op") markOp((stmt as { operation?: unknown }).operation);
    walkExpressions([stmt], (expr) => {
      if ((expr as { kind?: string }).kind === "hal-expr") markOp((expr as { operation?: unknown }).operation);
    });
  });
}

// ── Control-flow safety hooks (called from control-flow.ts) ────────────────

export type PinLevelSnapshot = Map<number, TrackedPinLevel>;

export function snapshotPinLevels(): PinLevelSnapshot {
  return new Map(pinLevels);
}

export function restorePinLevels(snapshot: PinLevelSnapshot): void {
  pinLevels.clear();
  for (const [pin, level] of snapshot) pinLevels.set(pin, level);
}

/**
 * Merge two branch-end states into the live state: pins that agree keep
 * their level; pins that differ (or exist in only one branch) become
 * unknown. Pass the pre-branch state as one side when there is no else
 * branch, so pins written in the taken branch invalidate.
 */
export function mergePinLevels(a: PinLevelSnapshot, b: PinLevelSnapshot): void {
  const pins = new Set([...a.keys(), ...b.keys()]);
  for (const pin of pins) {
    const la = a.get(pin) ?? 'unknown';
    const lb = b.get(pin) ?? 'unknown';
    pinLevels.set(pin, la === lb ? la : 'unknown');
  }
}

/** Invalidate all known levels (after loop/switch bodies, which may run any
 *  number of times). Shadow tracking is unaffected — it is runtime truth. */
export function invalidatePinLevels(): void {
  for (const pin of outputPins) pinLevels.set(pin, 'unknown');
}

/** Disable/enable constant folding around function and callback bodies. */
export function setPinFoldingEnabled(enabled: boolean): void {
  foldingEnabled = enabled;
}

/** Whether pin-level constant folding is currently allowed. */
export function isPinFoldingEnabled(): boolean {
  return foldingEnabled;
}
