// ---------------------------------------------------------------------------
// Pulldown Capability Validation
//
// Checks that pins configured with inputPullDown() actually support
// hardware pulldown on the target board. Emits a compile-time error if not.
// ---------------------------------------------------------------------------

import type { Diagnostic } from '../types.js';
import type { PeripheralUsage } from './peripheral-usage.js';
import type { BoardConstants } from './board-resolver.js';
import { pinEntryIndexForNumber } from './pin-capability-validation.js';

/**
 * Validate that pins used with inputPullDown() support pulldown on this board.
 */
export function validatePulldownSupport(
  usage: PeripheralUsage,
  boardConstants: BoardConstants | undefined,
  filePath: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (usage.inputPulldownPins.size === 0) {
    return diagnostics;
  }

  for (const pinNumber of usage.inputPulldownPins) {
    // Check the pin's own pullDown capability from board definition.
    // undefined or false both mean pulldown is not supported on this pin.
    // The entry is resolved by pin NUMBER — the pins.all array index diverges
    // from the number on MCUs with unbonded pads (see pinEntryIndexForNumber).
    const entryIdx = pinEntryIndexForNumber(pinNumber, boardConstants);
    if (entryIdx < 0) continue; // Unknown pin — the emitter's own resolution reports it.
    const supportsPullDown = boardConstants?.get(`pins.all.${entryIdx}.capabilities.pullDown`);
    if (supportsPullDown !== true) {
      const pinName = getPinName(pinNumber, boardConstants);
      const arch = boardConstants?.get('architecture') as string | undefined;
      diagnostics.push({
        code: 'pulldown-not-supported',
        message: `${pinName ?? `pin ${pinNumber}`} does not support hardware pulldown${arch ? ` on ${arch.toUpperCase()} boards` : ''}. Use ${pinName ?? 'pin'}.asInput() or ${pinName ?? 'pin'}.inputPullUp() instead.`,
        filePath,
        source: 'pulldown-validation',
        severity: 'error',
      });
    }
  }

  return diagnostics;
}

/**
 * Get the human-readable pin name (e.g., "D3", "A0") from pin number.
 */
function getPinName(pinNumber: number, boardConstants: BoardConstants | undefined): string | undefined {
  if (!boardConstants) {
    if (pinNumber >= 14 && pinNumber <= 19) return `A${pinNumber - 14}`;
    return `D${pinNumber}`;
  }

  const entryIdx = pinEntryIndexForNumber(pinNumber, boardConstants);
  const name = entryIdx >= 0 ? boardConstants.get(`pins.all.${entryIdx}.name`) : undefined;
  if (typeof name === 'string') return name;

  // Fallback naming
  if (pinNumber >= 14 && pinNumber <= 19) {
    return `A${pinNumber - 14}`;
  }
  return `D${pinNumber}`;
}
