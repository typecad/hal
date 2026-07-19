import type { Esp32ChipDescriptor } from './types.js';
import { ESP32 }   from './esp32.js';
import { ESP32S3 } from './esp32s3.js';
import { ESP32C3 } from './esp32c3.js';
import { ESP32C6 } from './esp32c6.js';
import { normalizeIdfTarget } from '../lowering/util.js';

export { ESP32, ESP32S3, ESP32C3, ESP32C6 };
export type { Esp32ChipDescriptor } from './types.js';

let activeChip: Esp32ChipDescriptor = ESP32;

export function setActiveChip(d: Esp32ChipDescriptor): void {
  activeChip = d;
}

export function getActiveChip(): Esp32ChipDescriptor {
  return activeChip;
}

/**
 * Resolve a chip descriptor from frameworkData.target / buildTarget.
 * Accepts bare IDF targets ('esp32s3') or Arduino FQBNs ('esp32:esp32:esp32s3').
 */
export function chipForTarget(target?: string): Esp32ChipDescriptor {
  switch (normalizeIdfTarget(target)) {
    case 'esp32s3': return ESP32S3;
    case 'esp32c3': return ESP32C3;
    case 'esp32c6': return ESP32C6;
    case 'esp32':
    default:
      return ESP32;
  }
}
