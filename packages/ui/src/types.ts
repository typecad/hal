// ---------------------------------------------------------------------------
// Element types — the shape of typed `.ui.html` imports.
//
// When an author writes `import { screen } from './app.ui.html'`, the lowering
// transformer emits a .ui.html.d.ts declaring `screen` as a ScreenTree whose
// fields are these element types. Each carries the hardware-binding methods
// (onPress/onRelease) that lower to GPIO edge handlers.
//
// The press/release methods are defined once on a shared base and applied via
// intersection rather than `extends`, so element variants don't fight over a
// shared __kind discriminator literal.
// ---------------------------------------------------------------------------

/** Methods every interactive element gets: GPIO edge handlers for :pressed. */
export interface PressBinding {
  /** Attach a GPIO falling-edge handler that flips this node's :pressed state. */
  onPress(pin: number | string): void;
  /** Attach a GPIO rising-edge handler that clears :pressed. */
  onRelease(pin: number | string): void;
}

export type TextElement = { readonly __kind: "text" } & PressBinding;
export type ButtonElement = { readonly __kind: "button" } & PressBinding;
export type ViewElement = { readonly __kind: "view" } & PressBinding;

export interface ScreenTree {
  [id: string]: TextElement | ButtonElement | ViewElement;
}
