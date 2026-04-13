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
 * Architectures that do NOT support hardware pulldown.
 * AVR (ATmega328P, etc.) only has pull-up, not pull-down.
 */
const NO_PULLDOWN_ARCHS = new Set(['avr']);

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

  const arch = boardConstants?.get('architecture') as string | undefined;
  if (arch && NO_PULLDOWN_ARCHS.has(arch)) {
    for (const pinNumber of usage.inputPulldownPins) {
      const pinName = getPinName(pinNumber, boardConstants);
      diagnostics.push({
        code: 'pulldown-not-supported',
        message: `${pinName ?? `pin ${pinNumber}`} does not support hardware pulldown on ${arch?.toUpperCase()} boards. Use ${pinName ?? 'pin'}.input() or ${pinName ?? 'pin'}.inputPullUp() instead.`,
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
