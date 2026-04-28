// ---------------------------------------------------------------------------
// Shift namespace handler — maps TypeHAL Shift.* calls to Arduino C++
// ---------------------------------------------------------------------------

import type { ExpressionIR, BoardConstants } from '@typehal/core/shared';

/** Convert a pin name to a raw Arduino integer (D2 → 2, A0 → A0). */
function pinArgRaw(rawPin: string): string {
  if (/^D\d+$/.test(rawPin)) return rawPin.slice(1);
  return rawPin;
}

/**
 * Render Shift namespace calls to Arduino C++.
 *
 * Direct functions:
 * - Shift.in(dataPin, clockPin, bitOrder) → shiftIn(dataPin, clockPin, bitOrder)
 * - Shift.out(dataPin, clockPin, bitOrder, value) → shiftOut(...)
 *
 * Fluent chains:
 * - Shift.read(dataPin).clock(clockPin).msbFirst() → shiftIn(dataPin, clockPin, MSBFIRST)
 * - Shift.read(dataPin).clock(clockPin).lsbFirst() → shiftIn(dataPin, clockPin, LSBFIRST)
 * - Shift.write(dataPin, value).clock(clockPin).msbFirst() → shiftOut(dataPin, clockPin, MSBFIRST, value)
 * - Shift.write(dataPin, value).clock(clockPin).lsbFirst() → shiftOut(dataPin, clockPin, LSBFIRST, value)
 */
export function renderShiftCall(
  parts: string[],
  args: ReadonlyArray<ExpressionIR>,
  renderArg: (e: ExpressionIR) => string,
  _boardConstants?: BoardConstants,
): string | undefined {
  const a = (i: number) => (args[i] !== undefined ? renderArg(args[i]) : '');

  if (parts.length === 2) {
    switch (parts[1]) {
      case 'in':
        return `shiftIn(${pinArgRaw(a(0))}, ${pinArgRaw(a(1))}, ${a(2)})`;
      case 'out':
        return `shiftOut(${pinArgRaw(a(0))}, ${pinArgRaw(a(1))}, ${a(2)}, ${a(3)})`;
    }
  }

  if (parts.length === 4 && parts[1] === 'read') {
    const dataPin  = pinArgRaw(a(0));
    const clockPin = pinArgRaw(a(1));
    const bitOrder = parts[3] === 'lsbFirst' ? 'LSBFIRST' : 'MSBFIRST';
    return `shiftIn(${dataPin}, ${clockPin}, ${bitOrder})`;
  }

  if (parts.length === 4 && parts[1] === 'write') {
    const dataPin  = pinArgRaw(a(0));
    const value    = a(1);
    const clockPin = pinArgRaw(a(2));
    const bitOrder = parts[3] === 'lsbFirst' ? 'LSBFIRST' : 'MSBFIRST';
    return `shiftOut(${dataPin}, ${clockPin}, ${bitOrder}, ${value})`;
  }

  return undefined;
}
