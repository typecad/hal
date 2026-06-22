// ---------------------------------------------------------------------------
// DisplayProfile — declarative description of a display's capabilities.
//
// Lives in the project config (cuttlefish.config.ts) or in built-in framework
// profiles. Describes everything the transpiler needs to know about the
// display hardware: dimensions, color depth, rotation, pins, touch.
//
// Adding a new display = adding a profile. No framework code changes.
// ---------------------------------------------------------------------------

export interface TouchProfile {
  type: "resistive" | "capacitive";
  /** Library to include for touch input (e.g. "Adafruit_TouchScreen"). */
  library: string;
  /** Touch controller pins (resistive: xp/yp/xm/ym; capacitive: via I2C). */
  pins?: Record<string, string | number>;
  /** Raw ADC calibration range for resistive touch. */
  calibration?: { xMin: number; xMax: number; yMin: number; yMax: number };
}

export interface DisplayProfile {
  /** Driver id (must match a framework's supportedDisplayDrivers). */
  driver: string;

  /** Display width in pixels (after rotation). */
  width: number;

  /** Display height in pixels (after rotation). */
  height: number;

  /** Color format — drives transpile-time color resolution. */
  colorFormat: "rgb565" | "mono";

  /** Rotation 0-3 (0=portrait, 1=landscape). */
  rotation: number;

  /** Backlight pin (0 or undefined = no backlight control). */
  backlight?: number;

  /** Hardware SPI pin defaults (overridable by mount options). */
  spiPins?: { mosi: number; sck: number; miso: number };

  /** Touch input configuration (omit if no touch). */
  touch?: TouchProfile;
}

/**
 * Project-side display config from cuttlefish.config.ts.
 * Either references a built-in profile by name, or inlines all fields.
 */
export interface DisplayConfig {
  /** Reference a built-in profile (e.g. "ili9341-spi"). */
  profile?: string;

  // Inline overrides (used when no profile, or to override profile defaults)
  driver?: string;
  width?: number;
  height?: number;
  colorFormat?: "rgb565" | "mono";
  rotation?: number;
  backlight?: number;
  spiPins?: { mosi: number; sck: number; miso: number };
  touch?: TouchProfile | false;

  // Wiring (always project-specific)
  cs?: number;
  dc?: number;
  rst?: number;
  bus?: string;
}

/**
 * Resolve a DisplayConfig into a full DisplayProfile.
 * If `profile` is set, look it up in the registry and merge overrides.
 * If not set, use the inline fields directly.
 */
export function resolveDisplayProfile(
  config: DisplayConfig,
  registry: Map<string, DisplayProfile>,
): { profile: DisplayProfile; cs: number; dc: number; rst: number; bus: string } {
  let base: DisplayProfile;

  if (config.profile) {
    const found = registry.get(config.profile);
    if (!found) {
      throw new Error(
        `Unknown display profile "${config.profile}". Available: ${[...registry.keys()].join(", ") || "(none)"}`,
      );
    }
    base = { ...found };
  } else {
    base = {
      driver: config.driver ?? "ili9341",
      width: config.width ?? 320,
      height: config.height ?? 240,
      colorFormat: config.colorFormat ?? "rgb565",
      rotation: config.rotation ?? 1,
      backlight: config.backlight,
      spiPins: config.spiPins,
      touch: config.touch === false ? undefined : config.touch,
    };
  }

  // Apply overrides
  if (config.width !== undefined) base.width = config.width;
  if (config.height !== undefined) base.height = config.height;
  if (config.colorFormat !== undefined) base.colorFormat = config.colorFormat;
  if (config.rotation !== undefined) base.rotation = config.rotation;
  if (config.backlight !== undefined) base.backlight = config.backlight;
  if (config.spiPins !== undefined) base.spiPins = config.spiPins;
  if (config.touch === false) base.touch = undefined;
  else if (config.touch !== undefined) base.touch = config.touch;

  return {
    profile: base,
    cs: config.cs ?? 5,
    dc: config.dc ?? 21,
    rst: config.rst ?? 22,
    bus: config.bus ?? "SPI",
  };
}
