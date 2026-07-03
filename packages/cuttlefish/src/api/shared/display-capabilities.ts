// ---------------------------------------------------------------------------
// DisplayCapabilities — declarative description of a display's rendering
// capabilities. The single source of truth that @media evaluation, feature-flag
// consultation, and (in later phases) the display shim all read.
//
// Phase 2 introduces the type + derivation. Default = today's TFT behavior, so
// output is byte-identical. Phase 3+ consumes it for shim routing.
// ---------------------------------------------------------------------------

/** Native pixel format the panel stores / the shim quantizes to at push. */
export type NativeFormat = "rgb888" | "rgb666" | "rgb565" | "mono" | "palette";

/** How the panel accepts refreshed pixels. */
export type RefreshModel = "immediate" | "deferred-partial" | "deferred-full";

/** Scope of partial-refresh support (e-ink panels vary). */
export type PartialRefreshScope = "none" | "mono-only" | "full";

/** Feature flags the shim can honor. False ⇒ the core snaps/disables. */
export interface DisplayFeatureFlags {
  antialias: boolean;
  gradients: boolean;
  opacityBlend: boolean;
  smoothScroll: boolean;
  animation: boolean;
}

export interface DisplayCapabilities {
  nativeFormat: NativeFormat;
  /** For palette displays (e-ink multi-color): the ink set as CSS strings. */
  palette?: string[];
  refreshModel: RefreshModel;
  partialRefresh: PartialRefreshScope;
  /** Latency (ms) of a full refresh; used by the refresh scheduler (Phase 4). */
  fullRefreshMs?: number;
  /** Max sustained partial refreshes/sec. */
  maxPartialFps?: number;
  /** Shim requires a backing store (e-ink, any dithered target). */
  requiresBackingStore: boolean;
  features: DisplayFeatureFlags;
}

/** The capabilities a fast RGB565 TFT has today — the Phase 2 default so
 *  output stays byte-identical with pre-descriptor behavior. */
export function defaultTftCapabilities(): DisplayCapabilities {
  return {
    nativeFormat: "rgb565",
    refreshModel: "immediate",
    partialRefresh: "full",
    requiresBackingStore: false,
    features: {
      antialias: true,
      gradients: true,
      opacityBlend: true,
      smoothScroll: true,
      animation: true,
    },
  };
}

/** A minimal profile shape deriveCapabilities reads. Keeps it decoupled from
 *  the full DisplayProfile (which references this module). */
interface ProfileLike {
  width: number;
  height: number;
  colorFormat: "rgb565" | "rgb666" | "rgb888" | "mono";
  displayClass?: "tft" | "eink" | "oled";
  capabilities?: DisplayCapabilities;
}

/** Derive capabilities from a profile. Explicit `capabilities` on the profile
 *  win; otherwise derive from `displayClass` + `colorFormat`. A bare TFT profile
 *  (no displayClass) defaults to defaultTftCapabilities() — byte-identical. */
export function deriveCapabilities(profile: ProfileLike): DisplayCapabilities {
  if (profile.capabilities) return profile.capabilities;
  if (profile.displayClass === "eink" || profile.displayClass === "oled") {
    return {
      nativeFormat: profile.colorFormat === "mono" ? "mono" : "palette",
      refreshModel: "deferred-partial",
      partialRefresh: profile.colorFormat === "mono" ? "mono-only" : "none",
      requiresBackingStore: true,
      features: {
        antialias: false,
        gradients: false,
        opacityBlend: false,
        smoothScroll: false,
        animation: false,
      },
    };
  }
  const base = defaultTftCapabilities();
  // rgb888 TFT (e.g. the SDL native target) carries true 888 to the surface;
  // all other TFT color formats are 565 by default (byte-identical history).
  if (profile.colorFormat === "rgb888") {
    base.nativeFormat = "rgb888";
  }
  return base;
}
