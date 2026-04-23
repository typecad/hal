// ---------------------------------------------------------------------------
// @typecode/framework-arduino — Handler Utilities
//
// Shared helper functions used by all peripheral handler modules.
// ---------------------------------------------------------------------------

import type { ExpressionIR } from '@typecode/core/shared';
import type { BoardConstants } from '@typecode/core/shared';

// ---------------------------------------------------------------------------
// Object field extraction
// ---------------------------------------------------------------------------

/**
 * Pull a named field out of an `{ kind: "object" }` ExpressionIR.
 * Returns undefined if the field is not present.
 */
export function getObjectField(
  expr: ExpressionIR,
  fieldName: string,
): ExpressionIR | undefined {
  if (expr.kind !== 'object') return undefined;
  return expr.fields.find(f => f.name === fieldName)?.value;
}

// ---------------------------------------------------------------------------
// Pin rendering helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a pin-like argument value (e.g., "D13" → "13", "LED" → board LED).
 */
export function pinLikeArgValue(value: string, boardConstants?: BoardConstants): string {
  if (value === 'LED') {
    const ledPinName = boardConstants?.get('pins.led');
    if (typeof ledPinName === 'string' && /^D(\d+)$/.test(ledPinName)) {
      return ledPinName.slice(1);
    }
    return 'LED_BUILTIN';
  }
  if (/^D\d+$/.test(value)) {
    return value.slice(1);
  }
  return value;
}
