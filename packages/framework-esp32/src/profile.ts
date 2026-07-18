import { chipForTarget, setActiveChip } from './chips/index.js';
import type { Esp32ChipDescriptor } from './chips/types.js';

export { chipForTarget, getActiveChip, setActiveChip } from './chips/index.js';
export type { Esp32ChipDescriptor } from './chips/types.js';

/**
 * Resolve the active ESP32 profile for the given target. Sets the
 * module-scope activeChip and returns it. Called early in forcedIncludes /
 * shimLines / resolveHALOperation so lowering code can read getActiveChip().
 * Spec §6.
 */
export function resolveEsp32Profile(target?: string): Esp32ChipDescriptor {
  const chip = chipForTarget(target);
  setActiveChip(chip);
  return chip;
}
