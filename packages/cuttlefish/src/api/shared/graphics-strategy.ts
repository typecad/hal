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

import type { DisplayHALOp } from "./display-op-ir.js";

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

  /** Target color format — drives transpile-time color resolution.
   *  Phase 1: 565/mono active. Phase 2+ will widen the plumbing (ColorFormat
   *  aliases in model.ts/ui-lowering.ts, resolveColor signature) to admit
   *  rgb666/rgb888/palette, at which point resolveColor888 is the resolution
   *  entry point. Widening only the return type now would break assignment to
   *  the "rgb565" | "mono" field types downstream. */
  colorFormat(): "rgb565" | "rgb666" | "rgb888" | "mono";

  /** Per-target capacity caps (node/binding/transition limits, storage). */
  graphicsCapacity(): GraphicsCapacity;
}
