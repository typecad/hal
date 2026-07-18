import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import { getActiveChip } from '../chips/index.js';

/** Resolve a HAL board.resolve op. Most board resolves happen at transpile
 *  time in the cuttlefish hal-plugins layer; this is the fallback for
 *  runtime-resolved values. For v1, emit a comment so unresolved board
 *  resolves are visible in the output. */
export function lowerBoard(op: HALOpIR): { code?: string; expression?: string } {
  if (op.operation !== 'board.resolve') {
    throw new Error(`lowerBoard called with non-board op: ${op.operation}`);
  }
  const chip = getActiveChip();
  return { expression: `/* board.resolve: chip=${chip.id} (unresolved key) */ 0` };
}
