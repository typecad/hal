// ---------------------------------------------------------------------------
// @typecad/framework-avr — AVR register helpers
//
// Chip-agnostic helpers over the active AVRChipDescriptor (see ./chips/).
// The previous revision hardcoded the ATmega328P pin/PWM/interrupt tables
// inline; those now live as data in chips/atmega328p.ts. These helpers read
// whichever descriptor is active, so adding a chip does not touch this file.
//
// All functions are pure reads of `activeChip`; none hardcode chip specifics.
// ---------------------------------------------------------------------------

import { activeChip } from './chips/index.js';
import type { AVRPinMap, AVRPwmPin } from './chips/types.js';

// Re-export the descriptor types so existing imports of PinRegisterInfo /
// PWMInfo keep working without callers having to know about the chips module.
export type PinRegisterInfo = AVRPinMap;
export type PWMInfo = AVRPwmPin & {
  /** Prescaler configuration (kept for backwards-compat with older callers). */
  prescaler: string;
  /** Timer control register (kept for backwards-compat). */
  tccr: string;
  /** Compare output mode bit (kept for backwards-compat). */
  comBit: string;
  /** Timer identifier for grouping (kept for backwards-compat). */
  timerId: string;
  /** Waveform generation mode bits (kept for backwards-compat). */
  wgmBits: string;
};

/**
 * Map an Arduino/framework pin number to its AVR port register info,
 * using the active chip descriptor.
 */
export function getPinInfo(pin: number): PinRegisterInfo | null {
  return activeChip.pins[pin] ?? null;
}

/**
 * Extract a pin number from a receiver name (e.g. "D13" -> 13, "A0" -> 14).
 * The "LED" alias resolves to pin 13 (the onboard LED on Arduino Uno/Nano).
 */
export function parsePinFromReceiver(receiver: string): number | null {
  if (receiver === 'LED') return 13;
  if (receiver.startsWith('D')) {
    const num = parseInt(receiver.slice(1), 10);
    return isNaN(num) ? null : num;
  }
  if (receiver.startsWith('A')) {
    const num = parseInt(receiver.slice(1), 10);
    return isNaN(num) ? null : 14 + num;
  }
  return null;
}

/**
 * Pre-computed bit mask for a pin (avoids a runtime shift), as a hex literal.
 */
export function getPinBitMask(pin: number): string {
  const info = getPinInfo(pin);
  if (!info) return '0';
  return `0x${(1 << info.bit).toString(16).toUpperCase()}`;
}

/**
 * Port output register name for a pin.
 */
export function getPortReg(pin: number): string | null {
  return getPinInfo(pin)?.port ?? null;
}

/**
 * Data-direction register name for a pin.
 */
export function getDDRReg(pin: number): string | null {
  return getPinInfo(pin)?.ddr ?? null;
}

/**
 * ADC channel number for an analog pin, or null if the pin has no ADC channel.
 */
export function getADCChannel(pin: number): number | null {
  return activeChip.adc.channelsByPin[pin] ?? null;
}

/**
 * PWM timer info for a pin, or null if the pin does not support PWM.
 *
 * The returned object includes both the descriptor's per-pin fields and the
 * backwards-compatible prescaler/wgmBits convenience strings derived from the
 * owning timer's init code.
 */
export function getPWMInfo(pin: number): PWMInfo | null {
  const p = activeChip.pwmByPin[pin];
  if (!p) return null;
  return {
    ...p,
    tccr: p.tccr,
    comBit: p.comBit,
    timerId: p.timerId,
    // Backwards-compat fields: older callers read these off the old PWM_MAP.
    // They are derived from the owning timer rather than carried per-pin.
    prescaler: activeChip.timers[p.timerId]?.initCode ?? '',
    wgmBits: '',
  };
}

/**
 * Whether a pin supports PWM.
 */
export function isPWMPin(pin: number): boolean {
  return pin in activeChip.pwmByPin;
}

/**
 * All PWM-capable pin numbers for the active chip.
 */
export function getPWMPins(): number[] {
  return Object.keys(activeChip.pwmByPin).map(Number);
}

/**
 * Infer a receiver kind from a pin number:
 *  - 'analog-input' for pins with an ADC channel
 *  - 'pwm' for PWM-capable pins (that are not analog inputs)
 *  - 'digital' otherwise
 */
export function inferReceiverKind(pin: number): 'analog-input' | 'digital' | 'pwm' {
  if (pin in activeChip.adc.channelsByPin) return 'analog-input';
  if (isPWMPin(pin)) return 'pwm';
  return 'digital';
}

/**
 * External-interrupt info for a pin, or null if it carries none.
 */
export function getInterruptInfo(pin: number): { interrupt: string; handler: string; vector: string } | null {
  return activeChip.interruptsByPin[pin] ?? null;
}

/**
 * Whether a pin supports external interrupts.
 */
export function isInterruptPin(pin: number): boolean {
  return pin in activeChip.interruptsByPin;
}
