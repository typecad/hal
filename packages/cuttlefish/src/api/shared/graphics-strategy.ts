// ---------------------------------------------------------------------------
// PlatformGraphicsStrategy — per-target graphics capacity and driver resolution
//
// Frameworks implement this sub-interface to (a) declare which display drivers
// they support (used by ui.mount() for fail-fast validation), (b) declare the
// target's color format (drives transpile-time color resolution), and (c)
// translate display HAL ops to driver-specific C++.
//
// Mirrors the existing resolveHALOperation() seam.
// ---------------------------------------------------------------------------

import type { DisplayHALOp } from "./display-op-ir";

export interface GraphicsCapacity {
  /** Max nodes the retained tree may hold on this target. */
  maxNodes: number;
  /** Max ui.bind() entries. */
  maxBindings: number;
  /** Max simultaneously-armed transitions. */
  maxActiveTransitions: number;
  /** Where the static node table lives. */
  nodeStorage: "progmem" | "flash";
}

export interface PlatformGraphicsStrategy {
  /** Resolve a display HAL op to target-specific C++. Return undefined to fall back. */
  resolveDisplayOp(op: DisplayHALOp): { code?: string; expression?: string } | undefined;

  /** Display driver ids this framework provides (e.g. new Set(["ili9341"])). */
  supportedDisplayDrivers(): ReadonlySet<string>;

  /** Target color format — drives transpile-time color resolution. */
  colorFormat(): "rgb565" | "mono";

  /** Per-target capacity caps (node/binding/transition limits, storage). */
  graphicsCapacity(): GraphicsCapacity;
}
