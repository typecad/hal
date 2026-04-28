// ---------------------------------------------------------------------------
// Pulse namespace handler — maps TypeHAL Pulse.* calls to Arduino C++
// ---------------------------------------------------------------------------

import type { ExpressionIR, BoardConstants } from '@typehal/core/shared';

/** Convert a pin name to a raw Arduino integer (D2 → 2, A0 → A0). */
function pinArgRaw(rawPin: string): string {
  if (/^D\d+$/.test(rawPin)) return rawPin.slice(1);
  return rawPin;
}

/**
 * Render Pulse namespace calls to Arduino C++.
 *
 * Direct functions:
 * - Pulse.in(pin, value, timeout?)  → pulseIn(pin, value, timeout)
 * - Pulse.long(pin, value, timeout?) → pulseInLong(pin, value, timeout)
 *
 * Fluent chains:
 * - Pulse.on(pin).high() → pulseIn(pin, HIGH)
 * - Pulse.on(pin).low()  → pulseIn(pin, LOW)
 * - Pulse.on.D2.high()   → pulseIn(2, HIGH)
 */
export function renderPulseCall(
  parts: string[],
  args: ReadonlyArray<ExpressionIR>,
  renderArg: (e: ExpressionIR) => string,
  _boardConstants?: BoardConstants,
): string | undefined {
  const a = (i: number) => (args[i] !== undefined ? renderArg(args[i]) : '');

  if (parts.length === 2) {
    switch (parts[1]) {
      case 'in': {
        const value = a(1);
        const pulseValue = value === 'true' ? 'HIGH' : value === 'false' ? 'LOW' : value;
        return args.length > 2
          ? `pulseIn(${pinArgRaw(a(0))}, ${pulseValue}, ${a(2)})`
          : `pulseIn(${pinArgRaw(a(0))}, ${pulseValue})`;
      }
      case 'long': {
        const value = a(1);
        const pulseValue = value === 'true' ? 'HIGH' : value === 'false' ? 'LOW' : value;
        return args.length > 2
          ? `pulseInLong(${pinArgRaw(a(0))}, ${pulseValue}, ${a(2)})`
          : `pulseInLong(${pinArgRaw(a(0))}, ${pulseValue})`;
      }
    }
  }

  if (parts.length === 3 && parts[1] === 'on') {
    const pin = pinArgRaw(a(0));
    switch (parts[2]) {
      case 'high': return `pulseIn(${pin}, HIGH)`;
      case 'low':  return `pulseIn(${pin}, LOW)`;
    }
  }

  if (parts.length === 4 && parts[1] === 'on') {
    // Pulse.on.D2.high()
    const pin = pinArgRaw(parts[2]);
    switch (parts[3]) {
      case 'high': return `pulseIn(${pin}, HIGH)`;
      case 'low':  return `pulseIn(${pin}, LOW)`;
    }
  }

  return undefined;
}
