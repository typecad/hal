// ---------------------------------------------------------------------------
// Element types — the shape of typed `.ui.html` imports.
//
// Every interactive element has a `.value` property that is both readable
// and writable. Writing updates the display; reading returns the current
// state. Pin input (onToggle/onPress/onChange) auto-updates `.value`.
//
// The press/release methods are for the :pressed transition state.
// ---------------------------------------------------------------------------

/** Base interface: all elements have a readable/writable .value. */
export interface UIElement {
  /** The element's state. check: 0/1, button: 0/1, select: 0..N, text: number.
   *  Reading returns the current state; writing updates the display. */
  value: number;
}

/** GPIO edge handlers for :pressed transitions. */
export interface PressBinding {
  onPress(pin: number | string): void;
  onRelease(pin: number | string): void;
}

export type TextElement = UIElement & PressBinding & { readonly __kind: "text" };
export type ButtonElement = UIElement & PressBinding & { readonly __kind: "button" };
export type ViewElement = { readonly __kind: "view" };

/** A checkbox element. .value is 0 (unchecked) or 1 (checked). */
export interface CheckElement extends UIElement {
  readonly __kind: "check";
  /** Watch a GPIO pin for falling edges. Flips .value automatically.
   *  Optional callback runs after the flip. */
  onToggle(pin: number, onChange?: () => void): void;
}

export interface ScreenTree {
  [id: string]: TextElement | ButtonElement | ViewElement | CheckElement;
}
