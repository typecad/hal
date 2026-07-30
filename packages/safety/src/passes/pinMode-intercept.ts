// The post-build IR transform. Walks the built ProgramIR and injects a
// safety.record_pin_mode companion statement after every gpio.set_mode op
// (the canonical HAL op produced by Pin.asInput()/asOutput()/asInputPullUp()/
// asInputPullDown() in @typecad/hal). This makes the runtime mode table
// authoritative regardless of how the user configured the pin.
//
// Produces a NEW ProgramIR via mapProgramStatements; does not mutate the input.
//
// Part A v1 scanned "gpio.pin_mode" — a string that does not exist in the
// canonical HALOpIR union. v2 fixes this to the canonical "gpio.set_mode".
// See docs/superpowers/specs/2026-07-27-safety-package-part-a-design.md.

import type { HALOpIR, ProgramIR, StatementIR } from "@typecad/cuttlefish/api";
import { mapProgramStatements } from "@typecad/cuttlefish/api";
import type { SafetyTransformContext } from "@typecad/cuttlefish/safety-hook-types";
import { mapModeString, TrackedMode } from "../hal/ops.js";

/** The canonical HAL op that configures a pin's mode. Pin.asInput() /
 *  asOutput() / asInputPullUp() / asInputPullDown() all inline to
 *  gpioSetMode(pin, "INPUT"/"OUTPUT"/...) which produces this op. */
const PIN_MODE_OPS = new Set(["gpio.set_mode"]);

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

/** If stmt is a hal-op statement carrying a gpio.set_mode op, return a
 *  singleton array containing the companion record_pin_mode statement;
 *  else []. */
function collectPinModeCompanions(stmt: StatementIR): StatementIR[] {
  if (stmt.kind !== "hal-op") return [];
  const op = (stmt as { operation: HALOpIR }).operation;
  if (typeof op.operation !== "string") return [];
  if (!PIN_MODE_OPS.has(op.operation)) return [];

  // gpio.set_mode carries { pin: number; mode: string } where mode is the
  // uppercase Arduino macro form ("INPUT"/"OUTPUT"/"INPUT_PULLUP"/
  // "INPUT_PULLDOWN") inlined by the HAL Pin class bodies.
  const pinModeOp = op as unknown as { pin?: unknown; mode?: unknown };
  if (typeof pinModeOp.pin !== "number" || typeof pinModeOp.mode !== "string") return [];

  return [makeCompanion(pinModeOp.pin, mapModeString(pinModeOp.mode))];
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
