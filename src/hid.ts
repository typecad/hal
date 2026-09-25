// ---------------------------------------------------------------------------
// Keyboard / Mouse — USB HID devices over the Zephyr "next" USB stack
//
// One HID interface per program (Zephyr's zephyr,hid-device node — a v1
// ceiling like the nRF PWM matrix: Keyboard OR Mouse, not both). begin()
// registers the boot report descriptor and starts the device stack; the
// verbs maintain the boot report in the LOWERED C++ — Keyboard keeps an
// 8-byte report (modifier byte + 6 key slots), Mouse a 4-byte one (buttons
// + relative x/y/wheel) — and each verb submits one input report. Key and
// button arguments are KEY.*/MOUSE.* tokens; the lowering maps them
// name-for-name onto Zephyr's HID_KEY_* / button macros.
// ----------------------------------------------------------------------------

import {
  hidKbBegin, hidKbPress, hidKbRelease, hidKbReleaseAll,
  hidMouseBegin, hidMouseMove, hidMousePress, hidMouseRelease, hidMouseClick,
} from './emit.js';

/** USB HID keyboard keys and modifiers — `KEY.A`, `KEY.CTRL`, `KEY.F1`.
 *  The tokens map 1:1 onto Zephyr's HID_KEY_* usage codes. */
export const KEY = {
  A: 4, B: 5, C: 6, D: 7, E: 8, F: 9, G: 10, H: 11, I: 12, J: 13, K: 14,
  L: 15, M: 16, N: 17, O: 18, P: 19, Q: 20, R: 21, S: 22, T: 23, U: 24,
  V: 25, W: 26, X: 27, Y: 28, Z: 29,
  N1: 30, N2: 31, N3: 32, N4: 33, N5: 34, N6: 35, N7: 36, N8: 37, N9: 38, N0: 39,
  ENTER: 40, ESC: 41, BACKSPACE: 42, TAB: 43, SPACE: 44,
  MINUS: 45, EQUAL: 46, LEFTBRACE: 47, RIGHTBRACE: 48,
  BACKSLASH: 49, SEMICOLON: 51, APOSTROPHE: 52, GRAVE: 53,
  COMMA: 54, DOT: 55, SLASH: 56, CAPSLOCK: 57,
  F1: 58, F2: 59, F3: 60, F4: 61, F5: 62, F6: 63,
  F7: 64, F8: 65, F9: 66, F10: 67, F11: 68, F12: 69,
  PRINTSCREEN: 70, SCROLLLOCK: 71, PAUSE: 72, INSERT: 73, HOME: 74,
  PAGEUP: 75, DEL: 76, END: 77, PAGEDOWN: 78, RIGHT: 79, LEFT: 80,
  DOWN: 81, UP: 82,
  CTRL: 0xE0, SHIFT: 0xE1, ALT: 0xE2, GUI: 0xE3,
} as const;

/** USB HID mouse buttons — `MOUSE.LEFT`. Bitmask OR-able. */
export const MOUSE = {
  LEFT: 1, RIGHT: 2, MIDDLE: 4,
} as const;

/**
 * A USB HID keyboard: `const kb = new Keyboard(); kb.begin();
 * kb.press(KEY.CTRL); kb.press(KEY.A); kb.releaseAll();`. The report is the
 * 8-byte boot layout (modifier + 6 concurrent keys); every press/release
 * submits one report. Modifiers (CTRL/SHIFT/ALT/GUI) live in the modifier
 * byte, keys fill the 6 slots in press order.
 */
export class Keyboard {
  /** Register the boot-keyboard report descriptor and start the USB
   *  device stack. Call once before any press/release. */
  begin(): void {
    hidKbBegin();
  }

  /** Press a key (or modifier) — `kb.press(KEY.A)` or `kb.press(KEY.CTRL)`.
   *  Modifiers OR into the modifier byte; keys take the first free slot. */
  press(key: number): void {
    hidKbPress(key);
  }

  /** Release a key or modifier. */
  release(key: number): void {
    hidKbRelease(key);
  }

  /** Release everything — zeroes the whole report. */
  releaseAll(): void {
    hidKbReleaseAll();
  }
}

/**
 * A USB HID mouse: `const m = new Mouse(); m.begin(); m.move(10, -4);`
 * `m.click(MOUSE.LEFT);`. Movement is relative (boot-mouse semantics) —
 * x/y clamp to -127..127 per report; wheel rolls in y.
 */
export class Mouse {
  /** Register the boot-mouse report descriptor and start the USB device
   *  stack. Call once before any movement. */
  begin(): void {
    hidMouseBegin();
  }

  /** Move relative to the current position — `m.move(dx, dy)` or with a
   *  wheel step `m.move(dx, dy, wheel)`. */
  move(dx: number, dy: number, wheel = 0): void {
    hidMouseMove(dx, dy, wheel);
  }

  /** Press (hold) a button — `m.press(MOUSE.LEFT)`. */
  press(button: number): void {
    hidMousePress(button);
  }

  /** Release a button. */
  release(button: number): void {
    hidMouseRelease(button);
  }

  /** Click a button — press and release as two reports. */
  click(button: number): void {
    hidMouseClick(button);
  }
}
