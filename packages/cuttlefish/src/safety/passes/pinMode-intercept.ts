// The post-build IR transform. Walks the built ProgramIR and injects a
// safety.record_pin_mode companion statement after every pin-configuring
// gpio op — gpio.configure (the thin GPIO constructor / set re-configure)
// and gpio.read_cfg (the fused guarded-configure + read). This makes the
// runtime mode table authoritative regardless of how the user configured
// the pin.
//
// v3: the thin HAL replaced gpio.set_mode's Arduino mode strings with
// gpio.configure's flag tokens ("GPIO.OUTPUT | GPIO.PULL_UP"). The flags
// field carries token text at IR time; configure-shaped flag sets map onto
// the TrackedMode enum, anything else (a runtime expression, an open-drain
// combo with no tracked equivalent) records Unknown so the voter still sees
// a fresh table entry rather than a stale mode.
//
// Produces a NEW ProgramIR via mapProgramStatements; does not mutate the input.
// See docs/superpowers/specs/2026-07-27-safety-package-part-a-design.md.

import type { HALOpIR, ProgramIR, StatementIR } from "../../api/index.js";
import { mapProgramStatements } from "../../api/index.js";
import type { SafetyTransformContext } from "../../safety-hook.js";
import { mapFlagTokens, TrackedMode } from "../hal/ops.js";

/** The gpio ops that (re)configure a pin's direction/flags. */
const PIN_MODE_OPS = new Set(["gpio.configure", "gpio.read_cfg"]);

export function pinModeInterceptPass(
  program: ProgramIR,
  ctx: SafetyTransformContext,
): ProgramIR {
  if (!ctx.safetyInUse) return program;

  return mapProgramStatements(program, (stmt) => {
    const companions = collectPinModeCompanions(stmt);
    return companions.length === 0 ? [stmt] : [stmt, ...companions];
  });
}

/** If stmt is a hal-op statement carrying a pin-configuring gpio op, return a
 *  singleton array containing the companion record_pin_mode statement;
 *  else []. */
function collectPinModeCompanions(stmt: StatementIR): StatementIR[] {
  if (stmt.kind !== "hal-op") return [];
  const op = (stmt as { operation: HALOpIR }).operation;
  if (typeof op.operation !== "string") return [];
  if (!PIN_MODE_OPS.has(op.operation)) return [];

  // gpio.configure / gpio.read_cfg carry { pin: number; flags: string }
  // where flags is flag-token text ("GPIO.INPUT | GPIO.PULL_UP") or an
  // unresolved runtime expression.
  const pinModeOp = op as unknown as { pin?: unknown; flags?: unknown };
  if (typeof pinModeOp.pin !== "number" || typeof pinModeOp.flags !== "string") return [];

  return [makeCompanion(pinModeOp.pin, mapFlagTokens(pinModeOp.flags))];
}

function makeCompanion(pin: number, mode: TrackedMode): StatementIR {
  const companionOp: HALOpIR = {
    operation: "safety.record_pin_mode",
    pin,
    mode,
  } as unknown as HALOpIR;
  return {
    kind: "hal-op",
    operation: companionOp,
    returns_value: false,
    sourceSpan: { startLine: 0, startColumn: 0, filePath: "<safety-companion>" },
  } as unknown as StatementIR;
}
