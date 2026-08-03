// ---------------------------------------------------------------------------
// Board constant lowering — dead-letter for board.resolve
//
// The `board` HAL category has a single op, `board.resolve`, which carries a
// dot-`path` into the loaded board/MCU definition (e.g.
// "peripherals.pwm.resolution"). On Zephyr — exactly as on Arduino — these
// values are compile-time constants folded into literals by the transpiler
// BEFORE any framework lowering runs:
//
//   - expression-to-ir.ts folds board()/boardResolve() *expressions* to a
//     literal (number/string) or 0 on miss.
//   - hal-emitter.ts folds a boardResolve() *return* and skips a
//     boardResolve() *statement* entirely.
//   - The Board.definition.<path> / Pins.definition.<path> *property-access*
//     path is folded by ZephyrStrategy.renderBoardDefinitionAccess (which the
//     expression-renderer calls with the populated board constants).
//
// Consequently a `board.resolve` HALOpIR only reaches this lowering as a
// dead-letter when the path could not be resolved. Returning `undefined` lets
// the emitter emit its standard unhandled-op warning, mirroring
// framework-arduino's `case "board.resolve"` (which likewise passes no board
// constants at resolve time). The manifest declares the op
// `probe-inconclusive` for the same reason: the minimal validator probe
// carries no path/board constants, so support cannot be cross-checked.
// ---------------------------------------------------------------------------

import type { HALOpIR } from '@typecad/cuttlefish/api/shared';

/**
 * Resolve a HAL board.* op. Always returns `undefined`: the value is folded
 * upstream at IR-build time, and this fn is only reached as a dead-letter.
 */
export function lowerBoard(
  op: HALOpIR,
): { code?: string; expression?: string } | undefined {
  void op;
  return undefined;
}
