// ---------------------------------------------------------------------------
// Arduino FQBN → PSRAM detection for @typecad/framework-arduino.
//
// Moved here from cuttlefish so cuttlefish no longer parses Arduino-specific
// FQBN strings. The framework resolves PSRAM availability from the build
// target and reports it via the generic `psram` flag (frameworkData.psram /
// ResolvedDisplay._psram); cuttlefish's scroll-canvas-memory budget then
// relies solely on that flag.
//
// Arduino FQBN build targets carry board options after the board id, e.g.
//   esp32:esp32:esp32s3:PSRAM=opi
// where the PSRAM=<value> option signals external PSRAM is enabled.
// ---------------------------------------------------------------------------

/** Detect PSRAM from an Arduino FQBN buildTarget (e.g. "esp32:esp32:esp32s3:PSRAM=opi").
 *  Returns true for any PSRAM=<value> option whose value indicates PSRAM is
 *  enabled (opi, io, qspi, enabled, true). Returns false when absent or set
 *  to a disabled-looking value (disabled, false, none). */
export function buildTargetHasPsram(buildTarget: string | undefined): boolean {
  if (!buildTarget) return false;
  const opts = buildTarget.split(":");
  for (const opt of opts) {
    const eq = opt.indexOf("=");
    if (eq < 0) continue;
    const key = opt.slice(0, eq).trim().toLowerCase();
    const val = opt.slice(eq + 1).trim().toLowerCase();
    if (key !== "psram") continue;
    // Any explicit PSRAM option except an explicit disabled value means PSRAM.
    return !["disabled", "false", "none", "no", "0"].includes(val);
  }
  return false;
}
