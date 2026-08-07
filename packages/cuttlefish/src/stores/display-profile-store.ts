// ---------------------------------------------------------------------------
// Display profile store — module-scoped profile for the current transpile run.
//
// Set early in transpileFile when the config's `display` field is loaded.
// All hardcoded display-value sites read from here via getDisplayProfile().
//
// This avoids deep changes to the config loader and TranspileOptions type —
// the full config plumbing can come later. The important thing is that
// display dimensions, pins, rotation, and touch config are data-driven.
// ---------------------------------------------------------------------------

import type { DisplayProfile, ResolvedDisplay } from "../api/shared/index.js";

export type { ResolvedDisplay };

let currentProfile: ResolvedDisplay | null = null;

/** Set the display profile for this transpile run. Called from transpileFile. */
export function setDisplayProfile(
  profile: DisplayProfile,
  wiring: { cs?: number; dc?: number; rst?: number; bus?: string; address?: number; reset?: number; buildTarget?: string },
): void {
  currentProfile = {
    ...profile,
    _mountCs: wiring.cs ?? 5,
    _mountDc: wiring.dc ?? 21,
    _mountRst: wiring.rst ?? 22,
    _mountBus: wiring.bus ?? "SPI",
    _mountAddress: wiring.address ?? 0x3C,
    _mountReset: wiring.reset ?? -1,
    _buildTarget: wiring.buildTarget,
  };
}

/** Get the current display profile, or a default if none set. */
export function getDisplayProfile(): ResolvedDisplay {
  if (currentProfile) return currentProfile;
  return {
    driver: "ili9341",
    width: 320,
    height: 240,
    colorFormat: "rgb565",
    rotation: 1,
    backlight: 17,
    spiPins: { mosi: 23, sck: 18, miso: 19 },
    _mountCs: 5,
    _mountDc: 21,
    _mountRst: 22,
    _mountBus: "SPI",
    _mountAddress: 0x3C,
    _mountReset: -1,
  };
}

/** Reset for the next transpile run. */
export function resetDisplayProfile(): void {
  currentProfile = null;
}
