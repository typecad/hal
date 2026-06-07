import { D2, LED, millis } from '@typecad';
import type { IInputModePin, InterruptHandler } from '@typecad';

// ── Domain types ──────────────────────────────────────────────────────────

type PressHandler = () => void;
type DebounceMs = number;

// ── Button class ──────────────────────────────────────────────────────────

export class Button {
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