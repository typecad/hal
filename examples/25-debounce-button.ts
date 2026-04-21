// ---------------------------------------------------------------------------
// Example 25 — Debounced Button with Class Pattern
//
// A reusable Button class using hardware interrupts with software debounce.
// Demonstrates TypeScript features the transpiler supports for classes:
//   - Static factory method (Button.start)
//   - Private constructor + private fields
//   - Method chaining with `this` return type
//   - Get accessor (-> bool isHeld() const in C++)
//   - Type aliases, readonly, default parameters
//   - Structural typing on the pin parameter (interrupt pins only)
// ---------------------------------------------------------------------------

import { D2, LED, millis } from '@typecode';
import type { IInputModePin, InterruptHandler } from '@typecode/core';

// ── Domain types ──────────────────────────────────────────────────────────

type PressHandler = () => void;
type DebounceMs = number;

// ── Button class ──────────────────────────────────────────────────────────

class Button {
  private readonly pin: IInputModePin;
  private readonly debounceMs: DebounceMs;
  private lastPress: number = 0;
  private handler: PressHandler | null = null;

  private constructor(pin: IInputModePin, debounceMs: DebounceMs) {
    this.pin = pin;
    this.debounceMs = debounceMs;
  }

  static start(
    pin: { asInputPullUp(): IInputModePin; onFalling(handler: InterruptHandler): void },
    debounceMs: DebounceMs = 50,
  ): Button {
    const input = pin.asInputPullUp();
    const btn = new Button(input, debounceMs);

    pin.onFalling(() => {
      const now = millis();
      if ((now - btn.lastPress) >= btn.debounceMs) {
        btn.lastPress = now;
        if (btn.handler !== null) {
          btn.handler();
        }
      }
    });

    return btn;
  }

  onPress(handler: PressHandler): this {
    this.handler = handler;
    return this;
  }

  get isHeld(): boolean {
    return this.pin.read() === false;
  }
}

// ── Usage ─────────────────────────────────────────────────────────────────

const led = LED.asOutput(false);

const btn = Button.start(D2, 50).onPress(() => {
  led.toggle();
});
