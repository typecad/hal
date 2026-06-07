// ---------------------------------------------------------------------------
// Pulldown Capability Validation
//
// Checks that pins configured with inputPullDown() actually support
// hardware pulldown on the target board. Emits a compile-time error if not.
// ---------------------------------------------------------------------------

import type { Diagnostic } from '../types';
import type { PeripheralUsage } from './peripheral-usage';
import type { BoardConstants } from './board-resolver';

/**
 * Validate that pins used with inputPullDown() support pulldown on this board.
 */
export function validatePulldownSupport(
  usage: PeripheralUsage,
  boardConstants: BoardConstants | undefined,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (usage.inputPulldownPins.size === 0) {
    return diagnostics;
  }

  for (const pinNumber of usage.inputPulldownPins) {
    // Check the pin's own pullDown capability from board definition
    // undefined or false both mean pulldown is not supported on this pin
    const supportsPullDown = boardConstants?.get(`pins.all.${pinNumber}.capabilities.pullDown`);
    if (supportsPullDown !== true) {
      const pinName = getPinName(pinNumber, boardConstants);
      const arch = boardConstants?.get('architecture') as string | undefined;
      diagnostics.push({
        code: 'pulldown-not-supported',
        message: `${pinName ?? `pin ${pinNumber}`} does not support hardware pulldown${arch ? ` on ${arch.toUpperCase()} boards` : ''}. Use ${pinName ?? 'pin'}.asInput() or ${pinName ?? 'pin'}.inputPullUp() instead.`,
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

  const name = boardConstants.get(`pins.all.${pinNumber}.name`);
  if (typeof name === 'string') return name;

  // Fallback naming
  if (pinNumber >= 14 && pinNumber <= 19) {
    return `A${pinNumber - 14}`;
  }
  return `D${pinNumber}`;
}
