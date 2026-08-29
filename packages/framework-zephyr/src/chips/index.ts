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
import { ESP32_DEVKITC } from './esp32.js';
import { SOC_CHIPS } from './soc/index.js';

export { XIAO_BLE, ESP32S3_DEVKITC, ESP32_DEVKITC, SOC_CHIPS };

/**
 * Resolve a consolidated soc-keyed descriptor from a Zephyr board target
 * ('esp32s3_devkitc/esp32s3/procpu', 'blackpill_f411ce/stm32f411xe') or a
 * bare soc name ('esp32s3'). The soc segment of the target is the registry
 * key. Returns undefined for unknown socs — callers decide the fallback.
 */
export function chipForSoc(targetOrSoc?: string): ZephyrChipDescriptor | undefined {
  const t = (targetOrSoc ?? '').trim().toLowerCase();
  if (!t) return undefined;
  // Qualified target ('board/soc/qualifier') → the soc segment is the key.
  if (t.includes('/')) return SOC_CHIPS[t.split('/')[1]];
  // Bare string: a soc name, or a board id ('esp32s3_devkitc') — the latter
  // matched against the descriptors' qualified ids.
  return SOC_CHIPS[t] ?? Object.values(SOC_CHIPS).find((c) => c.id.toLowerCase().startsWith(t + '/'));
}
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
 * id ('xiao_ble', 'esp32s3_devkitc', 'esp32_devkitc') or a board/qualifier
 * path ('esp32s3_devkitc/esp32s3/procpu', 'esp32_devkitc/esp32/procpu').
 */
export function chipForTarget(target?: string): ZephyrChipDescriptor {
  const t = (target ?? '').trim().toLowerCase();
  // Soc-keyed registry first — the consolidated per-soc descriptors cover
  // every validated soc and carry the curated naming/tier facts.
  const fromSoc = chipForSoc(t);
  if (fromSoc) return fromSoc;
  // Unknown target (or none): fall back to the canonical MVP board.
  return DEFAULT_CHIP;
}
