// ---------------------------------------------------------------------------
// @typecad/ui — public authoring API.
//
// These functions are compile-time constructs: the transpiler intercepts
// ui.mount / ui.signal / ui.bind and lowers them to device variables and
// binding-table entries. They have no runtime implementation in the emitted
// C++; their bodies exist only so TypeScript authoring type-checks.
// ---------------------------------------------------------------------------

export type { ScreenTree, TextElement, ButtonElement, ViewElement, PressBinding, CheckElement, SelectElement, RadioElement, ProgressElement, RangeElement, InputElement } from "./types";
import type { ScreenTree } from "./types";

/** A reactive signal whose value lives on the device. */
export interface Signal<T> {
  (): T;
  set(value: T): void;
}

export interface MountOptions {
  /** Display driver id (must be in the framework's supportedDisplayDrivers()). */
  display: string;
  /** Bus identifier, e.g. "SPI" or "Wire". */
  bus: string;
  /** Chip-select pin. */
  cs: number;
  /** Data/command pin. */
  dc: number;
  /** Reset pin. */
  rst: number;
}

/**
 * Mount a baked UI tree to a display. Validates the driver against the active
 * framework at transpile time (fail-fast). The tree is lowered to a static C++
 * node table; this call lowers to display.init + the first-frame draw.
 *
 * `tree` is typed loosely (a record of element handles) so the concrete
 * ScreenTree interface generated per .ui.html file — which has concrete named
 * fields rather than an index signature — is assignable. The transpiler
 * intercepts the call structurally; the type only needs to permit it.
 */
export declare function mount(tree: unknown, opts: MountOptions): void;

/**
 * Declare a reactive signal. Lowers to a plain device variable + dirty flag.
 */
export declare function signal<T>(initial: T): Signal<T>;

/**
 * Bind a node property to a computed value, re-evaluated each tick. When the
 * value changes, the node is marked dirty and (for transition-able properties)
 * the transition is armed.
 */
export declare function bind<K extends string>(
  node: unknown,
  property: K,
  compute: () => unknown,
): void;

/**
 * Watch a GPIO pin for falling edges (button press). The callback runs as an
 * async task in the existing microtask pump — no ISRs, natural debounce from
 * the ~20ms poll interval. Safe to write to signals inside the callback.
 *
 *   ui.watchPin(4, () => { count.set(count() + 1); });
 */
export declare function watchPin(pin: number, onFalling: () => void): void;

/**
 * Bind a `<list>` element to dynamic data via two callbacks.
 *
 *   ui.bindList(screen.myList,
 *     () => itemCount,          // total number of items
 *     (i) => `Item ${i}`        // text for item at index i
 *   );
 *
 * The list virtualizes: only visible items are rendered. Scroll by dragging.
 * The count function is called each frame; if the count changes, the list
 * refreshes automatically.
 */
export declare function bindList(
  node: unknown,
  countFn: () => number,
  itemFn: (index: number) => string,
  onTap?: (index: number) => void,
): void;

export const ui = { mount, signal, bind, watchPin, bindList };
export default ui;
