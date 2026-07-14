// AVR chip descriptor registry.
//
// `activeChip` is the descriptor currently driving code generation. It is
// set once by NativeAVRStrategy and read by the register helpers, so the
// rest of the package never branches on chip identity. Tests may swap it to
// exercise a different chip.

import type { AVRChipDescriptor } from './types.js';
import { ATMEGA328P } from './atmega328p.js';
import { ATMEGA2560 } from './atmega2560.js';

export type { AVRChipDescriptor, AVRPinMap, AVRTimer, AVRPwmPin, AVRInterruptPin, AVRAdcConfig, AVRUartConfig, AVRMillisTimer } from './types.js';
export { ATMEGA328P } from './atmega328p.js';
export { ATMEGA2560 } from './atmega2560.js';

/**
 * The descriptor driving the current code-generation run.
 *
 * Default is ATmega328P (the historical, and most popular, target).
 */
export let activeChip: AVRChipDescriptor = ATMEGA328P;

/**
 * Select the active chip. Called once per run by NativeAVRStrategy; also
 * used by tests to pin a specific chip.
 */
export function setActiveChip(chip: AVRChipDescriptor): void {
  activeChip = chip;
}

/**
 * Reset to the default chip (ATmega328P). Intended for test isolation.
 */
export function resetActiveChip(): void {
  activeChip = ATMEGA328P;
}
