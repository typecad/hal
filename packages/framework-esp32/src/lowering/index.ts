import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import { lowerGpio } from './gpio.js';
import { lowerTiming } from './timing.js';
import { lowerUart } from './uart.js';
import { lowerI2c }  from './i2c.js';
import { lowerSpi }  from './spi.js';
import { lowerPwm }  from './pwm.js';
import { lowerAdc }  from './adc.js';
import { lowerDac }  from './dac.js';
import { lowerTone } from './tone.js';
import { lowerInterrupts } from './interrupts.js';
import { lowerPower } from './power.js';
import { lowerWdt }   from './wdt.js';
import { lowerPulse, lowerShift } from './pulse-shift.js';
import { lowerBoard } from './board.js';

/**
 * Dispatch a HALOpIR to the appropriate peripheral lowering function.
 * Returns `{ code }` for statement ops, `{ expression }` for value-returning
 * ops. Throws on unknown ops (no silent fallback). Spec §2.3.
 */
export function lowerHalOp(op: HALOpIR): { code?: string; expression?: string } {
  if (op.operation.startsWith('gpio.'))      return lowerGpio(op);
  if (op.operation.startsWith('timing.'))    return lowerTiming(op);
  if (op.operation.startsWith('uart.'))      return lowerUart(op);
  if (op.operation.startsWith('i2c.'))       return lowerI2c(op);
  if (op.operation.startsWith('spi.'))       return lowerSpi(op);
  if (op.operation.startsWith('pwm.'))       return lowerPwm(op);
  if (op.operation.startsWith('adc.'))       return lowerAdc(op);
  if (op.operation.startsWith('dac.'))       return lowerDac(op);
  if (op.operation.startsWith('tone.'))      return lowerTone(op);
  if (op.operation.startsWith('interrupt.')) return lowerInterrupts(op);
  if (op.operation.startsWith('power.'))     return lowerPower(op);
  if (op.operation.startsWith('wdt.'))       return lowerWdt(op);
  if (op.operation.startsWith('pulse.'))     return lowerPulse(op);
  if (op.operation.startsWith('shift.'))     return lowerShift(op);
  if (op.operation === 'board.resolve')      return lowerBoard(op);
  // raw and snprintf.emit: pass through verbatim
  if (op.operation === 'raw')                return { code: (op as any).code ?? '' };
  if (op.operation === 'snprintf.emit')      return { code: (op as any).code ?? (op as any).statement ?? '' };
  // Display ops are deferred to v1.1 (spec §9.2)
  if (op.operation.startsWith('display.'))   throw new Error(`framework-esp32 does not yet support display ops (v1.1).`);
  throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`. Open an issue or use rawCpp() to emit it manually.`);
}
