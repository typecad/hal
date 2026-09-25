// ---------------------------------------------------------------------------
// board-gate.test.ts — drift guards for the single-import surface.
//
// User code imports everything from '@typecad/hal', which the project
// tsconfig maps onto the generated board module. That module re-exports:
//   - the UNGATED hal surface verbatim (DERIVED by the engine's board-gate
//     reader from hal's index.ts value exports minus GATED_EXPORTS in
//     packages/hal/src/gate.ts), and
//   - the board-gated hardware classes only when the board's facts allow.
//
// These tests fail when someone adds a value export to hal's index without
// classifying it (new names must join either the derived ungated set or
// GATED_EXPORTS), when the derivation disagrees with hal's actual runtime
// surface, and when boardgen stops re-exporting the ungated surface.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as halIndex from '../../../packages/hal/src/index';
import { GATED_EXPORTS, BOARD_UNGATED_TYPE_EXPORTS } from '../../../packages/hal/src/gate';
import { getBoardGateData, __resetBoardGateCache } from '../../../packages/cuttlefish/src/board-gate';
import { generateBoard } from '../../../packages/framework-zephyr/src/boardgen';

// Pin resolution to the repo's hal source — the test asserts the derivation
// against THIS tree, regardless of where vitest runs from.
const HAL_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../packages/hal/src');

/** Toolchain metadata that hal exports but generated modules must not re-export. */
const METADATA = new Set(['GATED_EXPORTS', 'BOARD_UNGATED_TYPE_EXPORTS']);

beforeAll(() => {
  process.env.TYPECAD_HAL_DIR = HAL_SRC;
  __resetBoardGateCache();
});

describe('hal board-gate classification', () => {
  it('every hal value export is classified as ungated, gated, or toolchain metadata', () => {
    const { ungated, gated } = getBoardGateData();
    const ungatedSet = new Set(ungated);
    const gatedSet = new Set(gated);
    expect([...gatedSet]).toEqual([...GATED_EXPORTS]); // reader parsed gate.ts faithfully
    for (const name of Object.keys(halIndex)) {
      if (METADATA.has(name)) continue;
      expect(
        ungatedSet.has(name) || gatedSet.has(name),
        `hal exports '${name}' but it is in neither the derived ungated set nor GATED_EXPORTS — classify it in gate.ts so the virtual '@typecad/hal' surface stays complete`,
      ).toBe(true);
    }
  });

  it('the ungated and gated sets are disjoint', () => {
    const { ungated, gated } = getBoardGateData();
    const gatedSet = new Set(gated);
    for (const name of ungated) {
      expect(gatedSet.has(name), `'${name}' is both ungated and gated`).toBe(false);
    }
  });

  it('the lists carry no duplicates', () => {
    const { ungated, ungatedTypes } = getBoardGateData();
    expect(new Set(ungated).size).toBe(ungated.length);
    expect(new Set(ungatedTypes).size).toBe(ungatedTypes.length);
    expect(new Set(BOARD_UNGATED_TYPE_EXPORTS).size).toBe(BOARD_UNGATED_TYPE_EXPORTS.length);
  });
});

describe('generated board module (single-import surface)', () => {
  const { boardTs } = generateBoard('xiao_ble/nrf52840');

  it('re-exports the ungated surface so every hal name stays importable', () => {
    const { ungated, ungatedTypes } = getBoardGateData();
    expect(boardTs).toContain(
      `export { ${ungated.join(', ')} } from '@typecad/hal/core';`,
    );
    expect(boardTs).toContain(
      `export type { ${ungatedTypes.join(', ')} } from '@typecad/hal/core';`,
    );
  });

  it('reaches the implementation package only through the ./core subpath', () => {
    expect(boardTs).toContain("from '@typecad/hal/core'");
    // The plain specifier inside the module would be circular: the project
    // tsconfig maps '@typecad/hal' onto this very file.
    expect(boardTs).not.toContain("from '@typecad/hal'");
  });

  it('keeps board-gated classes narrowed (XIAO nRF52840 has no DAC)', () => {
    // Servo rides the PWM gate — exported wherever PWM silicon routes exist.
    expect(boardTs).toMatch(/export \{ PWM, Servo \} from '@typecad\/hal\/core';/);
    expect(boardTs).not.toMatch(/export \{ DAC \} from/);
  });
});
