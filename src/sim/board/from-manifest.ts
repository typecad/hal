// ---------------------------------------------------------------------------
// @typecad/hal/sim — Derive a SimBoard from a generated board.json manifest
// ---------------------------------------------------------------------------

import { createSimBoard } from './board-sim.js';
import type { SimBoard } from './board-sim.js';

/**
 * The shape of a project's generated `.typecad-hal/board.json` (the flat
 * dot-path constant map boardgen writes — see framework-zephyr's boardgen).
 * Only the pin/peripheral facts the simulator needs are read; everything
 * else is ignored.
 */
export interface BoardManifest {
  constants?: Record<string, string | number | boolean>;
}

interface ManifestPin {
  /** The global board pin number (the `pins.all.N.number` fact). */
  number: number;
  /** Datasheet pin name (`PA0`, `PC13`). */
  name: string;
  capabilities: Record<string, boolean>;
}

/** Every pins.all.* entry in the manifest, in index order. Walks the keys by
 *  pattern rather than counting from 0 — pin indexes stay contiguous in
 *  boardgen output today, but the addressing space is the NUMBER, not the
 *  index, so a sparse sweep must not truncate the board. */
function manifestPins(constants: Record<string, string | number | boolean>): ManifestPin[] {
  const pins: { index: number; pin: ManifestPin }[] = [];
  for (const key in constants) {
    const m = key.match(/^pins\.all\.(\d+)\.name$/);
    if (!m || typeof constants[key] !== 'string') continue;
    const index = Number(m[1]);
    const number = constants[`pins.all.${index}.number`];
    const capabilities: Record<string, boolean> = {};
    for (const cap of ['pwm', 'interrupt', 'analogInput', 'analogOutput', 'digitalInput', 'digitalOutput']) {
      capabilities[cap] = constants[`pins.all.${index}.capabilities.${cap}`] === true;
    }
    pins.push({
      index,
      pin: {
        number: typeof number === 'number' ? number : index,
        name: constants[key] as string,
        capabilities,
      },
    });
  }
  pins.sort((a, b) => a.index - b.index);
  return pins.map((p) => p.pin);
}

/**
 * Resolve a board pin NUMBER by datasheet name or silkscreen alias
 * (`manifestPinNumberByName(manifest, 'PC13')`, `manifestPinNumberByName(manifest, 'LED')`).
 * Returns undefined when the board exports no such pin — the sim starter
 * templates use this to light the real onboard LED instead of a hard-coded
 * arduino-era pin number.
 */
export function manifestPinNumberByName(
  manifest: BoardManifest,
  nameOrAlias: string,
): number | undefined {
  const constants = manifest.constants ?? {};
  for (const pin of manifestPins(constants)) {
    if (pin.name === nameOrAlias) return pin.number;
  }
  const alias = constants[`pins.aliases.${nameOrAlias}`];
  if (typeof alias === 'string') return manifestPinNumberByName(manifest, alias);
  return undefined;
}

/**
 * Build a simulated board from the project's generated board.json manifest.
 *
 * Unlike {@link createSimBoard}'s count-based defaults (an arduino-Uno-shaped
 * 14/6 board), the simulated pin layout, PWM/interrupt capability sets, and
 * bus counts come from the manifest the board generator wrote for THIS board —
 * the same facts the transpiler and the generated board module use.
 *
 * @example
 * ```ts
 * import { readFileSync } from 'node:fs';
 * import { createBoardFromManifest, manifestPinNumberByName } from '@typecad/hal/sim';
 *
 * const manifest = JSON.parse(readFileSync('.typecad-hal/board.json', 'utf-8'));
 * const board = createBoardFromManifest(manifest);
 * const led = board.digital(manifestPinNumberByName(manifest, 'LED')!);
 * ```
 *
 * | SimBoard field        | manifest source                          |
 * |-----------------------|------------------------------------------|
 * | digital pins          | every `pins.all.N` entry (number space)  |
 * | `pwmPins`             | `capabilities.pwm`                       |
 * | `interruptPins`       | `capabilities.interrupt`                 |
 * | uart/i2c/spi counts   | `peripherals.<bus>.count`                |
 * | analog pins           | none — zephyr analog pads ride pins.all  |
 */
export function createBoardFromManifest(manifest: BoardManifest): SimBoard {
  const constants = manifest.constants ?? {};
  const pins = manifestPins(constants);

  // The sim addresses pins by their BOARD number, so the pin array spans the
  // number space (max number + 1), not the entry count.
  const digitalPinCount = pins.reduce((max, p) => Math.max(max, p.number + 1), 0);
  const pwmPins = pins.filter((p) => p.capabilities.pwm).map((p) => p.number);
  const interruptPins = pins.filter((p) => p.capabilities.interrupt).map((p) => p.number);

  const busCount = (bus: string): number | undefined => {
    const n = constants[`peripherals.${bus}.count`];
    return typeof n === 'number' ? n : undefined;
  };

  return createSimBoard({
    digitalPinCount,
    analogPinCount: 0,
    pwmPins,
    interruptPins,
    uartCount: busCount('uart'),
    i2cBusCount: busCount('i2c'),
    spiBusCount: busCount('spi'),
  });
}
