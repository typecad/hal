import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import { lowerGpio } from './gpio.js';
import { lowerTiming } from './timing.js';
import { lowerUart } from './uart.js';
import { lowerI2c }  from './i2c.js';
import { lowerSpi }  from './spi.js';
import { lowerBoard } from './board.js';

/**
 * Dispatch a HALOpIR to the appropriate peripheral lowering function.
 * Returns `{ code }` for statement ops, `{ expression }` for value-returning
 * ops. Throws on unknown ops (no silent fallback). Spec §2.3.
 */
export function lowerHalOp(op: HALOpIR): { code?: string; expression?: string } {
  if (op.operation.startsWith('gpio.'))   return lowerGpio(op);
  if (op.operation.startsWith('timing.')) return lowerTiming(op);
  if (op.operation.startsWith('uart.'))   return lowerUart(op);
  if (op.operation.startsWith('i2c.'))    return lowerI2c(op);
  if (op.operation.startsWith('spi.'))    return lowerSpi(op);
  if (op.operation === 'board.resolve')   return lowerBoard(op);
  throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`. Open an issue or use rawCpp() to emit it manually.`);
}
