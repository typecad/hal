// ---------------------------------------------------------------------------
// DAC (Digital-to-Analog Converter) handler — maps TypeCode DAC1/DAC2 calls
// to ESP32 dacWrite() / dacDisable() C++.
//
// DAC1 → GPIO 25, DAC2 → GPIO 26 (ESP32-specific hardware pins).
// dacWrite(pin, value) accepts a value in the range 0–255.
//
// Requires: #include <driver/dac.h>   (injected by profile.ts for ESP32)
// ---------------------------------------------------------------------------

import type { ExpressionIR } from '@typecode/core/shared';

/** Maps TypeCode DAC receiver names to their ESP32 GPIO numbers. */
const DAC_PIN_MAP: Record<string, string> = {
  DAC1: '25',
  DAC2: '26',
};

/**
 * Render DAC1/DAC2 method calls to ESP32 C++.
 *
 * - DAC1.write(value)   → dacWrite(25, value)
 * - DAC1.disable()      → dacDisable(25)
 * - DAC2.write(value)   → dacWrite(26, value)
 * - DAC2.disable()      → dacDisable(26)
 */
export function renderDACCall(
  receiver: string,
  method: string,
  args: ReadonlyArray<ExpressionIR>,
  renderArg: (e: ExpressionIR) => string,
): string | undefined {
  const pin = DAC_PIN_MAP[receiver] ?? receiver;
  const a = (i: number) => (args[i] !== undefined ? renderArg(args[i]) : '');

  switch (method) {
    case 'write':   return `dacWrite(${pin}, ${a(0)})`;
    case 'disable': return `dacDisable(${pin})`;
    default:        return undefined;
  }
}
