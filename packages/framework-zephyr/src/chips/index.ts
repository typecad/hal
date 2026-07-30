// ---------------------------------------------------------------------------
// Chip descriptor registry — maps Zephyr board target → ZephyrChipDescriptor
//
// Mirrors framework-esp32/src/chips/index.ts: a module-level activeChip,
// setActiveChip/getActiveChip, and chipForTarget resolving from
// frameworkData.buildTarget. The strategy calls setActiveChip during profile
// resolution so the lowering reads a single cached descriptor.
// ---------------------------------------------------------------------------

import type { ZephyrChipDescriptor } from './types.js';
import { XIAO_BLE } from './xiao-ble.js';

export { XIAO_BLE };
export type { ZephyrChipDescriptor, ZephyrGpioDtSpec } from './types.js';

/**
 * Default chip used when no buildTarget is supplied. The XIAO nRF52840 is the
 * MVP's sole target; subsequent board additions extend the switch below.
 */
const DEFAULT_CHIP: ZephyrChipDescriptor = XIAO_BLE;

let activeChip: ZephyrChipDescriptor = DEFAULT_CHIP;

export function setActiveChip(d: ZephyrChipDescriptor): void {
  activeChip = d;
}

export function getActiveChip(): ZephyrChipDescriptor {
  return activeChip;
}

/**
 * Resolve a chip descriptor from the Zephyr board target string
 * (frameworkData.buildTarget / frameworkData.target). Accepts the bare board
 * id ('xiao_ble') or a board/qualifier path ('xiao_ble/nrf52840').
 */
export function chipForTarget(target?: string): ZephyrChipDescriptor {
  const t = (target ?? '').trim().toLowerCase();
  const boardId = t.split('/')[0];
  switch (boardId) {
    case 'xiao_ble':
      return XIAO_BLE;
    case '':
    default:
      return DEFAULT_CHIP;
  }
}
