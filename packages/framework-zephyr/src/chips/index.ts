// ---------------------------------------------------------------------------
// Chip descriptor cache — the mechanism the strategy's lowering reads.
//
// There is no curated descriptor registry: every board's chip view is
// reconstructed from its generated board manifest via resolveChipFromBoard
// (src/chips/resolve.ts). This module only caches that resolved descriptor
// for the process lifetime (setActiveChip during profile resolution, the
// lowering reads getActiveChip) and provides the empty fallback for
// contexts with no board at all.
// ---------------------------------------------------------------------------

import type { ZephyrChipDescriptor } from './types.js';

/**
 * The no-board fallback: no controllers, no buses, no silicon facts. The
 * lowering treats it as "unsupported operation" per subsystem, which is the
 * honest answer when no board resolved.
 */
export const NO_BOARD_CHIP: ZephyrChipDescriptor = {
  id: 'no-board',
  soc: '',
  gpioController: 'gpio0',
  gpio: { dtSpecs: [] },
  probeMethods: [],
};

let activeChip: ZephyrChipDescriptor = NO_BOARD_CHIP;

export function setActiveChip(d: ZephyrChipDescriptor): void {
  activeChip = d;
}

export function getActiveChip(): ZephyrChipDescriptor {
  return activeChip;
}
