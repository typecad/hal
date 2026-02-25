// ---------------------------------------------------------------------------
// @typecode/board-esp32-devkit — Interrupt helpers
//
// On the ESP32 every GPIO can trigger edge/level interrupts.
// Interrupt handlers must be placed in IRAM on ESP32 for reliability, but
// the transpiler handles that attribute automatically.
// ---------------------------------------------------------------------------

import type { InterruptHandler, InterruptMode } from '@typecode/core';

/**
 * Globally disable interrupts.
 * Maps to Arduino `noInterrupts()` / ESP-IDF `portDISABLE_INTERRUPTS()`.
 */
export declare function noInterrupts(): void;

/**
 * Re-enable interrupts after `noInterrupts()`.
 * Maps to Arduino `interrupts()` / ESP-IDF `portENABLE_INTERRUPTS()`.
 */
export declare function interrupts(): void;

/**
 * Attach an interrupt handler to a GPIO pin.
 * On the ESP32 any input-capable GPIO (0–39) supports external interrupts.
 *
 * @param pin      GPIO number (0–39)
 * @param handler  Callback executed on interrupt — keep it short and IRAM-safe
 * @param mode     Trigger mode (RISING, FALLING, CHANGE, LOW, HIGH)
 *
 * Maps to `attachInterrupt(digitalPinToInterrupt(pin), handler, mode)`.
 */
export declare function attachInterrupt(
  pin: number,
  handler: InterruptHandler,
  mode: InterruptMode,
): void;

/**
 * Detach a previously attached interrupt.
 * Maps to `detachInterrupt(digitalPinToInterrupt(pin))`.
 */
export declare function detachInterrupt(pin: number): void;
