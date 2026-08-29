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
  /** Effective (screen-space) dimensions after rotation. */
  readonly width: number;
  readonly height: number;
  /** Native panel dimensions before rotation, when they differ from the
   *  effective size (e.g. a 320x480 panel mounted landscape = 480x320). */
  readonly nativeWidth?: number;
  readonly nativeHeight?: number;
  readonly colorFormat: 'rgb565' | 'mono';
  /** Applied via display_set_orientation (0/90/180/270). */
  readonly rotation?: number;
  /** DT alias for the backlight GPIO (set high at init), if any. */
  readonly backlight?: string;
  /** Panel controller the direct-drive UI adapter targets. Selects the init
   *  sequence + pixel wire format (ST7796S: 18-bit; ILI9341: 16-bit RGB565).
   *  Required for rgb565 profiles; mono profiles use the direct-op GFX
   *  runtime and ignore it. */
  readonly controller?: ZephyrPanelController;
  /** DT compatible string for the display@0 node. Defaults per controller
   *  (see PANEL_CONTROLLER_DEFAULTS) — override only for a panel whose DT
   *  binding differs from its controller family. */
  readonly dtCompatible?: string;
  /** SPI controller nodelabel the panel hangs off (and SPI touch, if any).
   *  Default 'spi2' — the ESP32-S3 first general-purpose SPI controller. */
  readonly busLabel?: string;
  /** Nodelabel of the MIPI DBI bridge node carrying the dc/reset GPIOs.
   *  Default 'mipi_dbi' (the overlay emits the bridge under that label). */
  readonly bridgeLabel?: string;
}

/** Panel controllers the direct-drive UI adapter knows how to init. */
export type ZephyrPanelController = 'st7796s' | 'ili9341';

/** Per-controller DT + transport defaults, shared by the overlay generator
 *  (DT node props) and the UI adapter (init sequence + wire format). */
export const PANEL_CONTROLLER_DEFAULTS: Record<
  ZephyrPanelController,
  { dtCompatible: string }
> = {
  st7796s: { dtCompatible: 'sitronix,st7796s' },
  ili9341: { dtCompatible: 'ilitek,ili9341' },
};

/** Resolve a profile's panel controller, inferring it from the driver id when
 *  the profile doesn't declare one (the '<controller>-zephyr' naming scheme). */
export function panelControllerFor(
  profile: Pick<ZephyrDisplayProfile, 'driver' | 'controller'>,
): ZephyrPanelController {
  if (profile.controller) return profile.controller;
  if (profile.driver.startsWith('ili9341')) return 'ili9341';
  return 'st7796s';
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
    controller: 'ili9341',
    rotation: 90,
    backlight: 'backlight',
  },
  'st7796-zephyr': {
    // ST7796S SPI TFT, 320x480 RGB565 mounted landscape (effective 480x320).
    // Same DT nodelabel convention as the ILI9341 — the board's devicetree
    // carries the `display0` node bound to the ST7796 driver; the overlay
    // enables it via status="okay". Effective dims match the display
    // st7796-spi profile (480x320 landscape, rotation 1).
    driver: 'st7796-zephyr',
    dtLabel: 'display0',
    width: 480,
    height: 320,
    nativeWidth: 320,
    nativeHeight: 480,
    colorFormat: 'rgb565',
    controller: 'st7796s',
    rotation: 1,
    backlight: 'backlight',
  },
  'ssd1306-zephyr': {
    // Monochrome OLED (SSD1306-class, 128x64, 1bpp). Driven through Zephyr's
    // generic display API (the ssd1306 driver + a DT display node). The GFX
    // runtime (gfx.ts mono branch) keeps a full page-framebuffer and pushes it
    // on display_flush — the standard model for page-buffered OLEDs. Direct
    // display.* ops only (no @typecad/ui CuttlefishGFX rendering on mono).
    driver: 'ssd1306-zephyr',
    dtLabel: 'display0',
    width: 128,
    height: 64,
    colorFormat: 'mono',
    rotation: 0,
  },
};

/** The default profile used when resolveDisplayOp is probed without a display.init. */
export const DEFAULT_ZEPHYR_DISPLAY_PROFILE: ZephyrDisplayProfile =
  ZEPHYR_DISPLAY_PROFILES['ili9341-zephyr'];

/**
 * The Zephyr profiles mapped to the shared DisplayProfile shape — the single
 * mapping, so no consumer needs to know the DT-binding descriptor layout.
 * The strategy's getProfileRegistry() and the preview's profile-registry
 * loader both consume this (the same role `BUILT_IN_PROFILES` plays in
 * framework-arduino's displays modules).
 */
export const BUILT_IN_PROFILES: Record<string, import('@typecad/cuttlefish/api/shared').DisplayProfile> =
  Object.fromEntries(
    Object.entries(ZEPHYR_DISPLAY_PROFILES).map(([name, p]) => [
      name,
      {
        driver: p.driver,
        width: p.width,
        height: p.height,
        nativeWidth: p.nativeWidth,
        nativeHeight: p.nativeHeight,
        colorFormat: p.colorFormat,
        rotation: p.rotation ?? 1,
      },
    ]),
  );
