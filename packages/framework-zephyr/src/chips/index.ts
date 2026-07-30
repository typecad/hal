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
import { ESP32S3_DEVKITC } from './esp32s3.js';

export { XIAO_BLE, ESP32S3_DEVKITC };
export type { ZephyrChipDescriptor, ZephyrGpioDtSpec } from './types.js';

/**
 * Default chip used when no buildTarget is supplied. The XIAO nRF52840 is the
 * canonical MVP target; subsequent board additions extend the switch below.
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
 * id ('xiao_ble', 'esp32s3_devkitc') or a board/qualifier path
 * ('esp32s3_devkitc/esp32s3/procpu').
 */
export function chipForTarget(target?: string): ZephyrChipDescriptor {
  const t = (target ?? '').trim().toLowerCase();
  const boardId = t.split('/')[0];
  switch (boardId) {
    case 'xiao_ble':
      return XIAO_BLE;
    case 'esp32s3_devkitc':
      return ESP32S3_DEVKITC;
    case '':
    default:
      return DEFAULT_CHIP;
  }
}
