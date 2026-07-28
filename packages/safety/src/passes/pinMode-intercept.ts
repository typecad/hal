// The post-build IR transform. Walks the built ProgramIR and injects a
// safety.record_pin_mode companion statement after every gpio.pin_mode and
// safety.pin_mode op, so the runtime mode table is authoritative regardless
// of whether the user wrote safe.pinMode (explicit) or pinMode (auto-
// intercepted, including inside third-party libraries).
//
// Produces a NEW ProgramIR via mapProgramStatements; does not mutate the input.

import type { HALOpIR, ProgramIR, StatementIR } from "@typecad/cuttlefish/api";
import { mapProgramStatements } from "@typecad/cuttlefish/api";
import type { SafetyTransformContext } from "@typecad/cuttlefish/safety-hook-types";

/** Set of op operation strings that configure a pin's mode and so must be
 *  followed by a record_pin_mode companion. */
const PIN_MODE_OPS = new Set(["gpio.pin_mode", "safety.pin_mode"]);

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

/** If stmt is a hal-op statement carrying a pin-mode op, return a singleton
 *  array containing the companion record_pin_mode statement; else []. */
function collectPinModeCompanions(stmt: StatementIR): StatementIR[] {
  if (stmt.kind !== "hal-op") return [];
  const op = (stmt as { operation: HALOpIR }).operation;
  if (typeof op.operation !== "string") return [];
  if (!PIN_MODE_OPS.has(op.operation)) return [];

  // Extract pin + mode from the op. gpio.pin_mode and safety.pin_mode both
  // carry { pin: number; mode: 0|1|2 } (the mode arg is the raw TS value;
  // for gpio.pin_mode it is set by the GPIO HAL resolver to 0/1/2).
  const pinModeOp = op as unknown as { pin?: unknown; mode?: unknown };
  if (typeof pinModeOp.pin !== "number" || typeof pinModeOp.mode !== "number") return [];

  return [makeCompanion(pinModeOp.pin, pinModeOp.mode as 0 | 1 | 2)];
}

function makeCompanion(pin: number, mode: 0 | 1 | 2): StatementIR {
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
