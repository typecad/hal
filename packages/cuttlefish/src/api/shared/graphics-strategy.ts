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
import type { DisplayProfile, ResolvedDisplay, TouchProfile, TouchAdapterCodegen } from "./display-profile.js";
import type { DisplayAdapterCode } from "./display-adapter.js";

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

  /**
   * True if this strategy emits its own display adapters (e.g. framework-arduino
   * owns the Adafruit_GFX drivers, framework-native owns SDL). When false or
   * undefined, generateDisplayAdapter() falls back to cuttlefish's generic
   * built-in adapter registry.
   */
  providesDisplayAdapter?(): boolean;

  /**
   * Returns the adapter code for one display, or undefined to defer to cuttlefish's
   * built-in adapter registry. Only called when providesDisplayAdapter()
   * returns true.
   */
  resolveDisplayAdapter?(display: ResolvedDisplay): DisplayAdapterCode | undefined;

  /**
   * True if this strategy emits its own touch adapters (ESP32 native). When
   * false or undefined, generateTouchAdapter() falls back to the built-in
   * library switch (the Arduino path, unchanged).
   */
  providesTouchAdapter?(): boolean;

  /**
   * Returns the touch adapter codegen for the given touch profile, or
   * undefined to defer to the built-in library switch. Only called when
   * providesTouchAdapter() returns true. Returning undefined for an
   * unsupported library (e.g. XPT2046 on native IDF) lets the dispatch
   * surface a clear compile-time error instead of emitting incompatible code.
   */
  resolveTouchAdapter?(touch: TouchProfile): TouchAdapterCodegen | undefined;

  /**
   * Optional hook returning this framework's named display-profile registry
   * (profile name → DisplayProfile). When present, transpile.ts consults it to
   * resolve `display.profile` config values instead of dynamically importing a
   * framework module — so profile names resolve correctly per-framework.
   * Returns undefined to fall back to the legacy dynamic-import path.
   */
  getProfileRegistry?(): Map<string, DisplayProfile>;

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
