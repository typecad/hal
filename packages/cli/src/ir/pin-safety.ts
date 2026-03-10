// ---------------------------------------------------------------------------
// Pin Safety Validation
//
// Validates that unsafe pins are used with appropriate warnings.
// Generates diagnostics when pins marked as unsafe are used in the program.
// ---------------------------------------------------------------------------

import type { PeripheralUsage } from './peripheral-usage';
import type { BoardConstants } from './board-resolver';
import type { Diagnostic } from '../types';

/**
 * Validate unsafe pin usage and generate warning diagnostics.
 *
 * @param usage - Peripheral usage analysis containing pinsUsed set
 * @param boardConstants - Board constants containing pins.unsafe array
 * @returns Array of diagnostic warnings for unsafe pin usage
 */
export function validateUnsafePins(
  usage: PeripheralUsage,
  boardConstants: BoardConstants | undefined,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (!boardConstants) return diagnostics;
  if (!usage.pinsUsed || usage.pinsUsed.size === 0) return diagnostics;

  // Get unsafe pins list (stored as comma-separated string by board-resolver)
  const unsafePinsStr = boardConstants.get('pins.unsafe') as string | undefined;
  if (!unsafePinsStr) return diagnostics;

  const unsafePins = unsafePinsStr.split(',').map(s => s.trim());

  // Check each used pin against the unsafe list
  for (const pinName of usage.pinsUsed) {
    if (unsafePins.includes(pinName)) {
      diagnostics.push({
        severity: 'warning',
        message: `Pin '${pinName}' is marked as unsafe. Use with caution - this pin may have special boot behavior or conflict with system functions.`,
        code: 'unsafe-pin-usage',
        source: 'pin-safety',
      });
    }
  }

  return diagnostics;
}
