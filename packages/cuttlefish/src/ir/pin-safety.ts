// ---------------------------------------------------------------------------
// Pin Safety Validation
//
// Validates that unsafe pins are used with appropriate warnings.
// Generates diagnostics when pins marked as unsafe are used in the program.
// ---------------------------------------------------------------------------

import type { PeripheralUsage } from './peripheral-usage.js';
import type { BoardConstants } from './board-resolver.js';
import type { Diagnostic } from '../types.js';
import { findBoardPinByName, formatPinReference } from './board-pin-utils.js';

function buildUnsafePinMessage(
  pinName: string,
  boardConstants: BoardConstants | undefined,
): string {
  const boardName = boardConstants?.get('name');
  const boardLabel = typeof boardName === 'string' && boardName.length > 0
    ? ` on ${boardName}`
    : '';
  const metadata = findBoardPinByName(pinName, boardConstants);
  const pinReference = formatPinReference(pinName, metadata);

  if (metadata?.warnings[0]) {
    return `${pinReference} is marked as unsafe${boardLabel}. ${metadata.warnings[0]}.`;
  }

  if (metadata?.note) {
    return `${pinReference} is marked as unsafe${boardLabel}. ${metadata.note}.`;
  }

  if (metadata && metadata.alternateFunctions.length > 0) {
    return `${pinReference} is marked as unsafe${boardLabel}. It is also used for ${metadata.alternateFunctions.join(', ')}.`;
  }

  return `${pinReference} is marked as unsafe${boardLabel}. Use with caution - this pin may have special boot behavior or conflict with system functions.`;
}

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
  filePath: string,
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
    const boardPin = findBoardPinByName(pinName, boardConstants);
    const canonicalPinName = boardPin?.name ?? pinName;
    if (unsafePins.includes(canonicalPinName)) {
      diagnostics.push({
        severity: 'warning',
        message: buildUnsafePinMessage(pinName, boardConstants),
        code: 'unsafe-pin-usage',
        filePath,
        source: 'pin-safety',
      });
    }
  }

  return diagnostics;
}
