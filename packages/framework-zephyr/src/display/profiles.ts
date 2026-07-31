// ---------------------------------------------------------------------------
// Zephyr display profiles — DT-binding descriptors
//
// Analog of framework-arduino/src/displays/, but profiles describe a Zephyr
// devicetree node (DT_NODELABEL) to resolve via DEVICE_DT_GET, not Adafruit
// pin wiring. The GFX runtime (gfx.ts) reads width/height/colorFormat from the
// active profile to size its line buffer.
// ---------------------------------------------------------------------------

export interface ZephyrDisplayProfile {
  /** Driver id, matched against ctx.frameworkData.display / manifest drivers. */
  readonly driver: string;
  /** Devicetree nodelabel, e.g. 'display0'. Emitted as DT_NODELABEL(<dtLabel>). */
  readonly dtLabel: string;
  readonly width: number;
  readonly height: number;
  readonly colorFormat: 'rgb565' | 'mono';
  /** Applied via display_set_orientation (0/90/180/270). */
  readonly rotation?: number;
  /** DT alias for the backlight GPIO (set high at init), if any. */
  readonly backlight?: string;
}

/**
 * Built-in profile registry. Looked up by driver id. Add a profile here when a
 * new board's display node is wired into its devicetree.
 */
export const ZEPHYR_DISPLAY_PROFILES: Record<string, ZephyrDisplayProfile> = {
  'ili9341-zephyr': {
    driver: 'ili9341-zephyr',
    dtLabel: 'display0',
    width: 320,
    height: 240,
    colorFormat: 'rgb565',
    rotation: 90,
    backlight: 'backlight',
  },
};

/** The default profile used when resolveDisplayOp is probed without a display.init. */
export const DEFAULT_ZEPHYR_DISPLAY_PROFILE: ZephyrDisplayProfile =
  ZEPHYR_DISPLAY_PROFILES['ili9341-zephyr'];
