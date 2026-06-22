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
  /** Register a click handler for touch input. Only works when touch is
   *  configured in the display profile. Fires on tap within the element's box. */
  onClick(callback?: () => void): void;
}

/** GPIO edge handlers for :pressed transitions. */
export interface PressBinding {
  onPress(pin: number | string): void;
  onRelease(pin: number | string): void;
}

export type TextElement = UIElement & PressBinding & {
  readonly __kind: "text";
  onChange(pin: number, optionCount: number, onChange?: () => void): void;
};
export type ButtonElement = UIElement & PressBinding & { readonly __kind: "button" };
export type ViewElement = UIElement & {
  readonly __kind: "view";
  onToggle(pin: number, onChange?: () => void): void;
  onChange(pin: number, optionCount: number, onChange?: () => void): void;
};

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
