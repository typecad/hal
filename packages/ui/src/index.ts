// ---------------------------------------------------------------------------
// @typehal/ui — public authoring API.
//
// These functions are compile-time constructs: the transpiler intercepts
// ui.mount / ui.signal / ui.bind and lowers them to device variables and
// binding-table entries. They have no runtime implementation in the emitted
// C++; their bodies exist only so TypeScript authoring type-checks.
// ---------------------------------------------------------------------------

export type { ScreenTree, TextElement, ButtonElement, ViewElement, PressBinding } from "./types";
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
 */
export declare function mount(tree: ScreenTree, opts: MountOptions): void;

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

export const ui = { mount, signal, bind };
export default ui;
