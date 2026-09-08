// ---------------------------------------------------------------------------
// @typecad/hal/sim — Derive a SimBoard from a BoardDefinition
// ---------------------------------------------------------------------------

import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';
import { createSimBoard } from './board-sim.js';
import type { SimBoard } from './board-sim.js';

/**
 * Build a simulated board from a board package's `BoardDefinition`.
 *
 * A generated board manifest (.typecad-hal/board.json) carries `pins.all`
 * entries carry real framework pin numbers and per-pin capability flags, and
 * whose `peripherals` describe the ADC resolution/reference and bus counts.
 * This helper reads that authoritative data and produces a `SimBoard` whose
 * pin layout, PWM/interrupt pins, analog ADC config, and bus counts match the
 * real board — without hardcoding them.
 *
 * @example
 * ```ts
 * import boardDef from '../.typecad-hal/board.json';
 * import { createBoardFromDefinition } from '@typecad/hal/sim';
 *
 * const board = createBoardFromDefinition(ESP32S3Board);
 * board.digital(48).asOutput().high();  // the onboard LED
 * board.analog(0).injectVoltage(2.5);   // A0, 12-bit / internal reference
 * ```
 *
 * The board package must be built (its `dist/`) so the `BoardDefinition` is
 * importable at runtime.
 *
 * **Derived from the `BoardDefinition`:**
 *
 * | SimBoard field | BoardDefinition source |
 * |----------------|------------------------|
 * | `digitalPinCount` | `pins.digital.length` |
 * | `analogPinCount`  | `pins.analog.length` |
 * | `pwmPins`         | `pins.all` filtered by `capabilities.pwm` |
 * | `interruptPins`   | `pins.all` filtered by `capabilities.interrupt` (excluding `unsafe`) |
 * | `i2cBusCount`     | `peripherals.i2c.length` |
 * | `spiBusCount`     | `peripherals.spi.length` |
 * | `uartCount`       | `peripherals.uart.length` |
 * | ADC resolution    | `peripherals.adc[0].resolution` |
 * | ADC reference     | `peripherals.adc[0].referenceVoltage` |
 *
 * @param def - The board package's `BoardDefinition` (e.g. `ESP32S3Board`).
 * @returns A `SimBoard` configured to match the board.
 */
export function createBoardFromDefinition(def: BoardDefinition): SimBoard {
  const all = def.pins.all;

  const pwmPins = all
    .filter(p => p.capabilities?.pwm)
    .map(p => p.number);

  // Interrupt-capable pins, excluding any marked unsafe (e.g. boot-strap pins).
  // The `interrupt` capability flag is set per-pin in the board definition's
  // `pins.all`. Override with `createSimBoard({ interruptPins })` if your
  // board's flagging differs from the interrupts you want to simulate.
  const interruptPins = all
    .filter(p => p.capabilities?.interrupt && !p.unsafe)
    .map(p => p.number);

  const board = createSimBoard({
    digitalPinCount: def.pins.digital.length,
    analogPinCount: def.pins.analog.length,
    i2cBusCount: def.peripherals.i2c?.length ?? 1,
    spiBusCount: def.peripherals.spi?.length ?? 1,
    uartCount: def.peripherals.uart?.length ?? 1,
    pwmPins,
    interruptPins,
  });

  // Apply the board's ADC resolution and reference voltage to every analog
  // pin so readVoltage() produces board-accurate values out of the box.
  const adc = def.peripherals.adc?.[0];
  if (adc) {
    for (const pin of board.analogPins.values()) {
      if (typeof adc.resolution === 'number') {
        pin.setResolution(adc.resolution);
      }
      if (typeof adc.referenceVoltage === 'number') {
        pin.setReferenceVoltage(adc.referenceVoltage);
      }
    }
  }

  return board;
}
