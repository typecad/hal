import type { Esp32ChipDescriptor } from './types.js';
import { ESP32 }   from './esp32.js';
import { ESP32S3 } from './esp32s3.js';
import { ESP32C3 } from './esp32c3.js';
import { ESP32C6 } from './esp32c6.js';

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
 * Resolve a chip descriptor from frameworkData.target.
 * Replaces the FQBN-based router from the abandoned arduino-cli spec —
 * there is no FQBN here, just the IDF target string. Spec §6.2.
 */
export function chipForTarget(target?: string): Esp32ChipDescriptor {
  switch (target) {
    case 'esp32s3': return ESP32S3;
    case 'esp32c3': return ESP32C3;
    case 'esp32c6': return ESP32C6;
    case 'esp32':
    case undefined:
    default:
      return ESP32;
  }
}
