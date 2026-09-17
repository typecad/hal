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
  readonly colorFormat: 'rgb565' | 'mono' | 'gray8';
  /** Applied via display_set_orientation (0/90/180/270). */
  readonly rotation?: number;
  /** DT alias for the backlight GPIO (set high at init), if any. */
  readonly backlight?: string;
  /** Panel controller the direct-drive UI adapter targets. Selects the init
   *  sequence + pixel wire format (ST7796S: 18-bit; ILI9341: 16-bit RGB565).
   *  Required for rgb565 profiles; mono profiles use the direct-op GFX
   *  runtime and ignore it. */
  readonly controller?: ZephyrPanelController;
  /** How the UI adapter reaches the panel:
   *  - 'direct-spi' (default): the emitted adapter drives the panel directly
   *    over spi_write (Adafruit ST77xx protocol, CS held across command+data).
   *    Required for panels the in-tree drivers cannot init (clone ST7796S —
   *    the generic mipi-dbi-spi bridge deasserts CS between the command byte
   *    and its parameters, which scrambles those panels).
   *  - 'zephyr-display': the adapter calls Zephyr's display API
   *    (display_write/display_get_capabilities) on the DT display device; an
   *    in-tree panel driver (bound from the overlay's display node) owns the
   *    init sequence, rotation, and wire format. */
  readonly transport?: ZephyrDisplayTransport;
  /** Which mipi-dbi host device backs the panel driver under the
   *  'zephyr-display' transport:
   *  - 'spi-bridge' (default): the stock zephyr,mipi-dbi-spi host
   *    (CONFIG_MIPI_DBI_SPI). Fine for panels that tolerate per-transaction
   *    CS (standard ILI9341 modules).
   *  - 'local-hold-cs': an app-local host device the adapter emits — the
   *    mipi-dbi-spi protocol with CS held across each command+data burst
   *    (GPIO-managed, mirroring the hardware-verified direct transport).
   *    Needed for clone ST77xx panels the stock bridge scrambles; implements
   *    the mipi-hold-cs behavior the binding documents but 4.4.2 does not. */
  readonly dbiHost?: ZephyrDbiHost;
  /** The panel's R and B channels are crossed in 16-bit mode (verified clone
   *  ST7796S quirk): the native adapter swaps R/B channels at pack time so
   *  the in-tree driver's RGB565 stream renders with true colors (lossless —
   *  the direct transport instead avoids it by driving 18-bit mode). */
  readonly channelSwapRb?: boolean;
  /** RGB565 wire byte-order inversion: the overlay emits the st7796s-family
   *  rgb-is-inverted DT property, flipping the format the in-tree driver
   *  reports (565 <-> 565X) so the adapter byte-swaps at pack time. Clone
   *  SPI panels whose white reads purple / dark reads green need it. */
  readonly rgbInverted?: boolean;
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
  /** The board's own devicetree already wires this display (native_sim's
   *  built-in sdl_dc): the overlay emits NO display node — the dtLabel points
   *  at the board's node. */
  readonly boardProvidesDisplay?: boolean;
  /** Extra Kconfig fragments the profile requires (e.g. the SDL panel's mono
   *  pixel-format choice). Appended verbatim to the generated prj.conf. */
  readonly kconfig?: readonly string[];
}

/** How the UI adapter talks to the panel (see ZephyrDisplayProfile.transport). */
export type ZephyrDisplayTransport = 'direct-spi' | 'zephyr-display';

/** Which mipi-dbi host backs the panel driver (see ZephyrDisplayProfile.dbiHost). */
export type ZephyrDbiHost = 'spi-bridge' | 'local-hold-cs';

/** Resolve a profile's transport with the historical default. */
export function transportFor(
  profile: Pick<ZephyrDisplayProfile, 'transport'>,
): ZephyrDisplayTransport {
  return profile.transport ?? 'direct-spi';
}

/** Resolve a profile's mipi-dbi host. Clone-ST77xx panels need the local
 *  CS-holding host; everything else defaults to the stock SPI bridge. */
export function dbiHostFor(
  profile: Pick<ZephyrDisplayProfile, 'dbiHost' | 'controller'>,
): ZephyrDbiHost {
  if (profile.dbiHost) return profile.dbiHost;
  return profile.controller === 'st7796s' ? 'local-hold-cs' : 'spi-bridge';
}

/** Marker the display adapters stamp into the emitted source so the toolchain
 *  can recover the exact profile that produced it (one source of truth — the
 *  profile registry — instead of re-deriving geometry from emitted C). */
export const DISPLAY_PROFILE_MARKER = 'typecad-display-profile:';

/** Machine-readable facts line the adapters stamp beside the marker: JSON
 *  carrying everything the toolchain needs to regenerate the DT overlay —
 *  including synthesized (compatible-driven) profiles that have no registry
 *  entry. */
export function displayFactsLine(profile: ZephyrDisplayProfile): string {
  const controller = panelControllerFor(profile);
  const facts: Record<string, unknown> = {
    driver: profile.driver,
    transport: transportFor(profile),
    width: profile.width,
    height: profile.height,
  };
  if (profile.nativeWidth !== undefined) facts.nativeWidth = profile.nativeWidth;
  if (profile.nativeHeight !== undefined) facts.nativeHeight = profile.nativeHeight;
  if (controller !== undefined) facts.controller = controller;
  if (profile.rotation !== undefined) facts.rotation = profile.rotation;
  if (profile.channelSwapRb === true) facts.channelSwapRb = true;
  if (profile.rgbInverted === true) facts.rgbInverted = true;
  if (transportFor(profile) === 'zephyr-display') {
    facts.dbiHost = dbiHostFor(profile);
  }
  return `// typecad-display-facts: ${JSON.stringify(facts)}`;
}

/** Recover the profile whose adapter emitted this source, or undefined when
 *  no display adapter marker is present (no display in the program). Prefers
 *  the JSON facts line (carries synthesized profiles); falls back to the
 *  plain marker + registry lookup. */
export function profileFromEmittedSource(src: string): ZephyrDisplayProfile | undefined {
  const facts = src.match(/typecad-display-facts: (\{.*\})/);
  if (facts) {
    try {
      const f = JSON.parse(facts[1]) as Record<string, unknown>;
      const registered = ZEPHYR_DISPLAY_PROFILES[f.driver as string];
      if (registered) return registered;
      if (typeof f.driver === 'string' && isDtCompatible(f.driver)) {
        const synth = synthesizeZephyrProfile({
          driver: f.driver,
          width: f.width as number,
          height: f.height as number,
          nativeWidth: f.nativeWidth as number | undefined,
          nativeHeight: f.nativeHeight as number | undefined,
          rotation: f.rotation as number | undefined,
          channelSwapRb: f.channelSwapRb === true,
          rgbInverted: f.rgbInverted === true,
          csHold: f.dbiHost === 'local-hold-cs',
        });
        if (synth) return synth;
      }
    } catch {
      // Malformed facts line — fall through to the plain marker.
    }
  }
  const m = src.match(/typecad-display-profile: ([\w-]+)/);
  if (!m) return undefined;
  return ZEPHYR_DISPLAY_PROFILES[m[1]];
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
 *  the profile doesn't declare one (the '<controller>-zephyr' naming scheme).
 *  Synthesized (compatible-driven) profiles carry no controller — undefined
 *  routes them to the binding-driven generic paths. */
export function panelControllerFor(
  profile: Pick<ZephyrDisplayProfile, 'driver' | 'controller'>,
): ZephyrPanelController | undefined {
  if (profile.controller) return profile.controller;
  if (profile.driver.startsWith('ili9341')) return 'ili9341';
  if (profile.driver.startsWith('st7796')) return 'st7796s';
  return undefined;
}

/** A DT compatible string (vendor,name) — the drop-in driver id shape. */
export function isDtCompatible(driver: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*,[a-z0-9-]+$/i.test(driver);
}

/** 1bpp mono panel compatibles (DATA, not code): the Zephyr drivers behind
 *  these report PIXEL_FORMAT_MONO01/10 — the Stage 2 full-frame lowering
 *  target. A drop-in config naming one of these synthesizes a mono profile
 *  without an explicit colorFormat. Grows as mono drivers are verified; an
 *  unlisted mono panel still works via display.init({ colorFormat: 'mono' }).
 *  (ssd1320/ssd1327-class are L8/grayscale — Stage 3, not here.) */
const MONO_PANEL_COMPATIBLES: ReadonlySet<string> = new Set([
  'solomon,ssd1306',
  'solomon,ssd1309',
  'sinowealth,sh1106',
]);

/** 16-gray panels (Stage 3): Zephyr's solomon,ssd1327 driver accepts
 *  PIXEL_FORMAT_L_8 (8-bit luminance in, nibble-reduced to the panel's 16
 *  levels) — the Stage 3 gray8 lowering target. Same drop-in rule as mono. */
const GRAY_PANEL_COMPATIBLES: ReadonlySet<string> = new Set([
  'solomon,ssd1327',
]);

/** True when a drop-in compatible (or explicit config) selects the gray8
 *  (8-bit luminance) lowering target. */
export function isGrayDisplay(display: { driver: string; colorFormat?: string }): boolean {
  if (display.colorFormat === 'gray8') return true;
  if (display.colorFormat && display.colorFormat !== 'gray8') return false;
  return GRAY_PANEL_COMPATIBLES.has(display.driver);
}

/** True when a drop-in compatible (or explicit config) selects the mono
 *  (1bpp) lowering target. */
export function isMonoDisplay(display: { driver: string; colorFormat?: string }): boolean {
  if (display.colorFormat === 'mono') return true;
  if (display.colorFormat && display.colorFormat !== 'mono') return false;
  return MONO_PANEL_COMPATIBLES.has(display.driver);
}

/** Synthesize a native-transport profile for a compatible-driven config
 *  (display.driver = DT compatible, no registry profile). The in-tree driver
 *  bound by the overlay's display node owns init/geometry/quirks; the
 *  config's panel-quirk flags (channelSwapRb, csHold) carry what the
 *  driver cannot know. Returns undefined unless the driver string is a
 *  compatible shape. */
export function synthesizeZephyrProfile(display: {
  driver: string;
  width: number;
  height: number;
  nativeWidth?: number;
  nativeHeight?: number;
  colorFormat?: string;
  rotation?: number;
  channelSwapRb?: boolean;
  csHold?: boolean;
  rgbInverted?: boolean;
}): ZephyrDisplayProfile | undefined {
  if (!isDtCompatible(display.driver)) return undefined;
  return {
    driver: display.driver,
    dtLabel: 'display0',
    width: display.width,
    height: display.height,
    nativeWidth: display.nativeWidth,
    nativeHeight: display.nativeHeight,
    colorFormat: isMonoDisplay(display) ? 'mono' : isGrayDisplay(display) ? 'gray8' : 'rgb565',
    controller: undefined,
    transport: 'zephyr-display',
    dbiHost: display.csHold === true ? 'local-hold-cs' : undefined,
    channelSwapRb: display.channelSwapRb === true ? true : undefined,
    rgbInverted: display.rgbInverted === true ? true : undefined,
    rotation: display.rotation ?? 0,
    backlight: 'backlight',
  };
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
  // Same ILI9341 panel as 'ili9341-zephyr', but driven through Zephyr's
  // display API: the overlay's display0 node (ilitek,ili9341 under the
  // mipi-dbi-spi bridge) binds the in-tree driver with CONFIG_MIPI_DBI_SPI +
  // CONFIG_ILI9341, and the emitted adapter speaks display_write instead of
  // spi_write. The panel init sequence, rotation, and pixel wire format move
  // upstream (the driver owns them). Per-transaction CS (the mipi-dbi-spi
  // bridge's behavior) is fine on standard ILI9341 SPI modules — the
  // CS-held-across-command+data requirement that forces 'direct-spi' is a
  // clone-ST7796S-class quirk. The sibling 'st7796-zephyr-display' profile
  // is hardware-verified end-to-end; this one is compile/link-verified only
  // (no ILI9341 module on the rig yet).
  'ili9341-zephyr-display': {
    driver: 'ili9341-zephyr-display',
    dtLabel: 'display0',
    width: 320,
    height: 240,
    colorFormat: 'rgb565',
    controller: 'ili9341',
    transport: 'zephyr-display',
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
    // Monochrome OLED (SSD1306-class, 128x64, 1bpp) — Stage 2's mono
    // lowering target. The full-frame adapter (ui-adapter-mono.ts) keeps a
    // vtiled MONO01 backing store and pushes it whole each frame through
    // display_write on the DT display node (the ssd1306 driver over I2C
    // self-builds from the overlay's node). Raw display.* ops ride the same
    // model through gfx.ts's mono branch.
    driver: 'ssd1306-zephyr',
    dtLabel: 'display0',
    dtCompatible: 'solomon,ssd1306',
    width: 128,
    height: 64,
    colorFormat: 'mono',
    rotation: 0,
  },
  // The verified clone ST7796S on the demo rig, on the native display API:
  // the in-tree sitronix,st7796s driver (CONFIG_ST7796S) owns init/gamma/
  // geometry, backed by an app-local CS-holding mipi-dbi host the adapter
  // emits (dbiHost 'local-hold-cs' — the stock bridge deasserts CS between
  // command and data, which scrambles this clone; the local host implements
  // the mipi-hold-cs behavior Zephyr documents but 4.4.2 does not ship).
  // The clone's 16-bit color pipeline is handled at pack time (byte swap
  // via the reported 565X format — see the color notes below); the direct
  // transport avoids the question entirely by driving 18-bit mode.
  // Color pipeline (hardware-verified on the rig, 16-bit mode, three knobs):
  //   - rgb-is-inverted: byte-swap at pack time (565 wire order).
  //   - NO R/B channel swap (the 18-bit BGR finding does not transfer).
  //   - CS-hold (this profile's default local host): REQUIRED on this clone —
  //     the stock mipi-dbi-spi bridge toggles CS per transaction and
  //     corrupts pixel bursts (confirmed twice: the original bring-up, and
  //     the drop-in path's first stock-bridge build showed the same
  //     corruption until csHold was set). With all three, colors are
  //     hardware-confirmed correct on the rig. Ladder testing observed a
  //     slight uniform dimness vs the direct path's 18-bit mode; the direct
  // profile remains the max-fidelity option for this panel.
  // Touch: FT6336U on the input subsystem — its power enable must be driven
  // (resetPin 4 on the rig; see touch-adapter.ts for the rig-verified
  // sequence). Touch + UI interaction hardware-verified on the rig.
  'st7796-zephyr-display': {
    driver: 'st7796-zephyr-display',
    dtLabel: 'display0',
    width: 480,
    height: 320,
    nativeWidth: 320,
    nativeHeight: 480,
    colorFormat: 'rgb565',
    controller: 'st7796s',
    transport: 'zephyr-display',
    rotation: 1,
    backlight: 'backlight',
  },
  // Stage 2g — the no-hardware gate: the whole mono lowering on native_sim's
  // built-in SDL panel (zephyr,sdl-dc, 320x240). The board's devicetree
  // already wires sdl_dc, so the overlay emits no display node; the SDL
  // panel's pixel-format choice flips to MONO01 so the 1bpp adapter's
  // display_write flows render as black/white in the emulator window.
  // Compile+link only in CI (Linux — the POSIX arch does not build on
  // Windows); the SDL window needs libsdl2-dev on the runner to link.
  'native-sim-mono': {
    driver: 'native-sim-mono',
    dtLabel: 'sdl_dc',
    width: 320,
    height: 240,
    colorFormat: 'mono',
    transport: 'zephyr-display',
    boardProvidesDisplay: true,
    kconfig: ['CONFIG_SDL_DISPLAY_DEFAULT_PIXEL_FORMAT_MONO01=y'],
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
