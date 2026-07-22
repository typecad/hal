// ---------------------------------------------------------------------------
// AVR display adapter helpers — shared across all four AVR display drivers.
//
// Pin-control C++ expressions emitted at adapter-build time. The AVR strategy
// can't call its own strategy-side helpers (nativeDigitalWrite, nativePinMode)
// from adapter-emit code, so we emit the equivalent register expressions
// directly using the chip descriptor's pin map.
// ---------------------------------------------------------------------------

import { getPinInfo, getPinBitMask, getPortReg, getDDRReg } from "../registers.js";

/**
 * Emits a C++ expression that sets a pin HIGH: `PORTx |= 0xYZ`.
 * Returns a comment-only expression if the pin is invalid.
 */
export function avrPinHigh(pin: number): string {
  const port = getPortReg(pin);
  const mask = getPinBitMask(pin);
  if (!port) return `/* invalid pin ${pin} */`;
  return `${port} |= ${mask}`;
}

/**
 * Emits a C++ expression that sets a pin LOW: `PORTx &= ~0xYZ`.
 */
export function avrPinLow(pin: number): string {
  const port = getPortReg(pin);
  const mask = getPinBitMask(pin);
  if (!port) return `/* invalid pin ${pin} */`;
  return `${port} &= ~${mask}`;
}

/**
 * Emits a C++ statement that configures a pin as an output: `DDRx |= 0xYZ;`.
 */
export function avrPinOutput(pin: number): string {
  const ddr = getDDRReg(pin);
  const mask = getPinBitMask(pin);
  if (!ddr) return `/* invalid pin ${pin} */;`;
  return `${ddr} |= ${mask};`;
}

/**
 * Emits a C++ if-statement that conditionally sets a pin based on a runtime
 * boolean expression: `if (cond) PORTx |= mask; else PORTx &= ~mask;`.
 */
export function avrPinCond(pin: number, condExpr: string): string {
  const port = getPortReg(pin);
  const mask = getPinBitMask(pin);
  if (!port) return `/* invalid pin ${pin} */`;
  return `if (${condExpr}) ${port} |= ${mask}; else ${port} &= ~${mask}`;
}

/**
 * Returns the bit mask for a pin (e.g. pin 10 on ATmega328P → "0x04").
 */
export function avrPinMask(pin: number): string {
  return getPinBitMask(pin);
}

/**
 * Returns the PORT register name for a pin (e.g. "PORTB").
 */
export function avrPortName(pin: number): string | null {
  return getPortReg(pin);
}
