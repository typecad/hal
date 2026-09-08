// ---------------------------------------------------------------------------
// DisplayProfile — declarative description of a display's capabilities.
//
// Lives in the project config (typecad-hal.config.ts) or in built-in framework
// profiles. Describes everything the transpiler needs to know about the
// display hardware: dimensions, color depth, rotation, pins, touch.
//
// Adding a new display = adding a profile. No framework code changes.

import type { DisplayCapabilities } from "./display-capabilities.js";
//
// Touch uses an adapter pattern: either a built-in library name or a custom
// TypeScript file. The adapter provides isTouched() + read() → {x,y,z}.
// The transpiler handles calibration (raw ADC → screen pixels) and rotation.
// ---------------------------------------------------------------------------

export type TouchLibrary = "XPT2046_Touchscreen" | "Adafruit_TouchScreen" | "Adafruit_STMPE610" | "FT6336U" | "GT911" | "CST816S" | "sdl";

export interface TouchProfile {
  /**
   * Either a built-in library name OR a path to a custom TypeScript adapter
   * file (relative to the project root). The adapter must export:
   *   - isTouched(): boolean
   *   - read(): { x: number, y: number, z: number }
   *
   * Built-in: { library: 'XPT2046_Touchscreen', cs: 14, irq: 2 }
   * Custom:   { adapter: './my-touch-adapter' }
   */
  library?: TouchLibrary;
  adapter?: string;

  /** CS pin for SPI touch controllers (separate from display CS). */
  cs?: number;
  /** IRQ pin (optional). */
  irq?: number;
  /** Resistive 4-wire analog pins (Adafruit_TouchScreen only). */
  analogPins?: { xp: number; yp: number; xm: number; ym: number; rx: number };
  /** Software SPI pins (optional). */
  swSpiPins?: { mosi: number; miso: number; sck: number };
  /** I2C address for I2C touch controllers (FT6336U default 0x38). */
  i2cAddress?: number;
  /** I2C bus speed in Hz for I2C touch controllers. */
  i2cFrequency?: number;
  /** Reset pin for touch controllers requiring a hardware-reset sequence
   *  before begin() (FT6336U on boards with a reset GPIO tied to the chip). */
  resetPin?: number;
  /** I2C SDA pin (Zephyr: used to configure the I2C bus pinctrl in the DT overlay). */
  sda?: number;
  /** I2C SCL pin (Zephyr: used to configure the I2C bus pinctrl in the DT overlay). */
  scl?: number;

  /** Raw ADC calibration — maps touch controller raw values to display pixels. */
  calibration: { xMin: number; xMax: number; yMin: number; yMax: number };
  /** Minimum pressure/z to register a touch (default 10). */
  minPressure?: number;
}

export interface DisplayProfile {
  driver: string;
  /** Visible screen-space dimensions used by UI layout and preview. */
  width: number;
  height: number;
  /** Native panel dimensions before rotation, when they differ from layout size. */
  nativeWidth?: number;
  nativeHeight?: number;
  colorFormat: "rgb565" | "rgb666" | "rgb888" | "mono";
  /** Display class: "tft" (default) for fast-refresh panels, "eink" for
   *  bistable/slow-refresh panels. Drives capability derivation + @media. */
  displayClass?: "tft" | "eink" | "oled";
  /** Explicit capabilities override. If absent, capabilities are derived from
   *  displayClass + colorFormat. Phase 2 default (bare TFT) = today's behavior. */
  capabilities?: DisplayCapabilities;
  rotation: number;
  backlight?: number;
  spiFrequency?: number;
  spiPins?: { mosi: number; sck: number; miso: number };
  /** Pixel color channel order expected by the panel module. Default: rgb. */
  colorOrder?: "rgb" | "bgr";
  /** Optional explicit display inversion override. Some controller libraries
   *  use panel-specific defaults that do not match every module. */
  invertDisplay?: boolean;
  /**
   * Experimental dirty-rectangle synchronization using the controller's
   * GET_SCANLINE (0x45) readback command. This is opt-in: many ST7796S
   * modules expose SDO but return unreliable data or stop scanning when 0x45
   * is read, so a missing/unsafe readback path must not affect normal drawing.
   */
  scanlineSync?: boolean;
  /** Tearing-effect (TE) sync, hardware variant: GPIO number of the panel's
   *  TE output. Opt-in — few off-the-shelf display boards break the pin out.
   *  When wired, panel updates wait for the TE frame pulse instead of the
   *  GET_SCANLINE readback (no MISO needed; see also scanlineSync). */
  tearingEffectPin?: number;
  touch?: TouchProfile;
  /** Enable antialiased rendering for circles, lines, rounded corners, and text
   *  unless a node opts out with font-smoothing:none.
   *  Renders AA work to offscreen GFXcanvas16 buffers, blends edges, then draws. */
  antialias?: boolean;
  /** SDL desktop target only: render the window borderless at the current
   *  desktop resolution, scaling the fixed framebuffer to fill the monitor.
   *  true (or "desktop") = `SDL_WINDOW_FULLSCREEN_DESKTOP`. Ignored by hardware
   *  targets. Default: off (a normal titled window at width × height). */
  fullscreen?: boolean | "desktop";
  /** SDL desktop target only: the OS window title. Default "cuttlefish".
   *  Overridable at runtime via ui.window.setTitle(). Ignored by hardware. */
  title?: string;
  /** SDL desktop target only: window/taskbar icon image file path (BMP via
   *  core SDL2; .png/.ico require SDL_image). Ignored by hardware. */
  icon?: string;
  /** Scroll engine capability + physics tunables. Defaults are derived from the
   *  declared touch hardware when omitted (see resolveScrollConfig). */
  scroll?: ScrollConfig;
}

/** Extended profile with mount wiring (cs/dc/rst/address/reset from ui.mount).
 *  Lives here (not in the store) so api/shared has zero upward dependencies
 *  on ui/. The store populates it; display-adapter.ts types against it. */
export interface ResolvedDisplay extends DisplayProfile {
  _mountCs: number;
  _mountDc: number;
  _mountRst: number;
  _mountBus: string;
  _mountAddress: number;
  _mountReset: number;
  /** Framework build target string (e.g. a Zephyr board target like
   *  "esp32:esp32:esp32s3:PSRAM=opi" or an IDF target). Carried through for
   *  framework-side toolchain/compile use; cuttlefish itself does not parse it.
   *  Optional. */
  _buildTarget?: string;
}

export interface DisplayConfig {
  profile?: string;
  driver?: string;
  /** Visible screen-space dimensions used by UI layout and preview. */
  width?: number;
  height?: number;
  /** Native panel dimensions before rotation, when they differ from layout size. */
  nativeWidth?: number;
  nativeHeight?: number;
  colorFormat?: "rgb565" | "rgb888" | "mono";
  displayClass?: "tft" | "eink" | "oled";
  capabilities?: DisplayCapabilities;
  rotation?: number;
  /** Arduino framework: GPIO pin driving the panel backlight (set high at init). */
  backlight?: number;
  /** Zephyr framework: GPIO pin driving the panel backlight. When set, the
   *  framework emits a gpio-leds DT node + `backlight` alias so the display
   *  adapter drives it high at init. Omit when the backlight is hardwired to
   *  power (e.g. tied to 3.3V) — no node or alias is emitted in that case. */
  backlightPin?: number;
  spiFrequency?: number;
  spiPins?: { mosi: number; sck: number; miso: number };
  /** Pixel color channel order expected by the panel module. Default: rgb. */
  colorOrder?: "rgb" | "bgr";
  /** Optional explicit display inversion override. */
  invertDisplay?: boolean;
  /**
   * Opt in to experimental GET_SCANLINE (0x45) dirty-rectangle synchronization
   * on adapters that have a verified controller readback path. Disabled by
   * default because some ST7796S modules misbehave when this command is read.
   */
  scanlineSync?: boolean;
  /** Tearing-effect (TE) hardware sync: GPIO number of the panel's TE output
   *  (ST7796S TE / ILI9341 TE pin). Strictly opt-in — few off-the-shelf
   *  display boards break the pin out. When wired, panel updates arm on the
   *  TE frame pulse (tear-free writes, no MISO readback); the Zephyr overlay
   *  emits te-gpios on the display DT node and the adapter raises TEON. */
  tearingEffectPin?: number;
  touch?: TouchProfile | false;
  cs?: number;
  dc?: number;
  rst?: number;
  bus?: string;
  /** I2C address (hex, e.g. 0x3C). Used by I2C display drivers like SSD1309. */
  address?: number;
  /** Reset pin for I2C displays (separate from SPI `rst`). */
  reset?: number;
  antialias?: boolean;
  /** SDL desktop target only: render the window borderless at the current
   *  desktop resolution, scaling the fixed framebuffer to fill the monitor.
   *  Ignored by hardware targets. Default: off. */
  fullscreen?: boolean | "desktop";
  /** SDL desktop target only: the OS window title. Default "cuttlefish". */
  title?: string;
  /** SDL desktop target only: window/taskbar icon image file path (BMP). */
  icon?: string;
  /** Override the CSS theme file. Relative paths resolve from the .ui.html
   *  directory; absolute paths are used as-is. Default: sibling .ui.css. */
  themeCss?: string;
  /** Activate a class-scoped theme for CSS variables (e.g. "dark"). When set,
   *  var() substitution prefers variables defined under `.dark { ... }` over
   *  :root. One theme per build (transpile-time selection). */
  themeClass?: string;
  /** Scroll engine capability + physics tunables. Defaults are derived from the
   *  declared touch hardware when omitted (see resolveScrollConfig). */
  scroll?: ScrollConfig;
}

// ---------------------------------------------------------------------------
// Scroll engine config — capability tiers + physics tunables.
//
// All optional on the author side; resolveScrollConfig() fills defaults from
// the declared touch hardware (resistive chip → resistive input tier; ESP32-class
// SRAM → full render tier). Spec: docs/superpowers/specs/2026-06-28-scroll-engine-rewrite-design.md
// ---------------------------------------------------------------------------

export interface DisplaySize {
  width: number;
  height: number;
}

export function normalizeDisplayRotation(rotation?: number): 0 | 1 | 2 | 3 {
  const r = ((rotation ?? 0) % 4 + 4) % 4;
  return r as 0 | 1 | 2 | 3;
}

/** Return the screen-space dimensions after the display rotation is applied. */
export function effectiveDisplaySize(display: {
  width: number;
  height: number;
  nativeWidth?: number;
  nativeHeight?: number;
  rotation?: number;
}): DisplaySize {
  if (display.nativeWidth === undefined || display.nativeHeight === undefined) {
    return { width: display.width, height: display.height };
  }
  const rotation = normalizeDisplayRotation(display.rotation);
  return rotation === 1 || rotation === 3
    ? { width: display.nativeHeight, height: display.nativeWidth }
    : { width: display.nativeWidth, height: display.nativeHeight };
}

/** Input-quality axis: how raw touch becomes a smoothed scroll delta. */
export type ScrollInputTier = "capacitive" | "resistive" | "none";

/** Frame/refresh-budget axis: whether per-frame canvas repaint (incl. the
 *  rubber-band animation) is affordable. Constrained tiers get a cheaper path. */
export type ScrollRenderTier = "full" | "constrained";

/** Author-facing scroll config (all optional; defaults derived from hardware). */
export interface ScrollConfig {
  inputTier?: ScrollInputTier;
  renderTier?: ScrollRenderTier;
  /** Multiplier applied to drag deltas before scroll physics. Default 1.0. */
  dragScale?: number;
  /** Ceiling on rubber-band excursion past a boundary, in px. Default 40. */
  maxOverscroll?: number;
  /** Rubber-band resistance curve (higher = stiffer, less stretch). Default 0.5. */
  stiffness?: number;
  /** Radius within which release snaps to a boundary for free, in px. Default 12. */
  edgeSnapPx?: number;
  /** Low-pass coefficient for the resistive input filter (0 = passthrough).
   *  Capacitive/preview always passthrough regardless. Default 0.3. */
  inputSmoothing?: number;
  /** default true: trust the declared tiers (deterministic). When false, runtime
   *  probes may refine the input smoothing level from observed sample quality. */
  overrideProbes?: boolean;
  /** Emit per-frame scroll/canvas telemetry over Serial (UI_SCROLL_DEBUG). Off by
   *  default — enable temporarily to diagnose scroll/canvas draw skips on-device. */
  debug?: boolean;
}

/** Fully-resolved scroll config — every field populated, ready for emit. */
export interface ResolvedScrollConfig {
  inputTier: ScrollInputTier;
  renderTier: ScrollRenderTier;
  dragScale: number;
  maxOverscroll: number;
  stiffness: number;
  edgeSnapPx: number;
  inputSmoothing: number;
  overrideProbes: boolean;
  debug: boolean;
}

/** Touch libraries treated as resistive (noisy, low-sample-rate) panels. */
const RESISTIVE_TOUCH_LIBS: ReadonlySet<string> = new Set([
  "XPT2046_Touchscreen",
  "Adafruit_TouchScreen",
]);

/**
 * Resolve scroll config from a display profile. Declared overrides win;
 * otherwise derive the input tier from the touch library (resistive chips →
 * "resistive", any other touch → "capacitive", no touch → "none") and assume a
 * full render tier (ESP32-class SRAM can fit a viewport canvas).
 */
export function resolveScrollConfig(
  display: {
    touch?: TouchProfile | false;
    scroll?: ScrollConfig;
  },
): ResolvedScrollConfig {
  const s = display.scroll ?? {};
  const lib =
    display.touch && typeof display.touch === "object"
      ? display.touch.library
      : undefined;
  const derivedInput: ScrollInputTier =
    lib && RESISTIVE_TOUCH_LIBS.has(lib)
      ? "resistive"
      : display.touch
        ? "capacitive"
        : "none";
  return {
    inputTier: s.inputTier ?? derivedInput,
    renderTier: s.renderTier ?? "full",
    dragScale: s.dragScale ?? 1,
    maxOverscroll: s.maxOverscroll ?? 40,
    stiffness: s.stiffness ?? 0.5,
    edgeSnapPx: s.edgeSnapPx ?? 12,
    inputSmoothing: s.inputSmoothing ?? 0.3,
    overrideProbes: s.overrideProbes ?? true,
    debug: s.debug ?? false,
  };
}

export function resolveDisplayProfile(
  config: DisplayConfig,
  registry: Map<string, DisplayProfile>,
): { profile: DisplayProfile; cs: number; dc: number; rst: number; bus: string; address: number; reset: number } {
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
      nativeWidth: config.nativeWidth,
      nativeHeight: config.nativeHeight,
      // The SDL adapter renders to a 32-bit desktop framebuffer and is
      // RGB888-only (uint32_t throughout). The generic default is rgb565
      // (byte-identical to bare TFT hardware), but a desktop window has no
      // 565 surface — default SDL to rgb888 so UI_COLOR_T matches the adapter
      // and colors reach the window at full 24-bit precision.
      colorFormat: config.colorFormat ?? (config.driver === "sdl" ? "rgb888" : "rgb565"),
      rotation: config.rotation ?? 1,
      backlight: config.backlight,
      spiFrequency: config.spiFrequency,
      spiPins: config.spiPins,
      colorOrder: config.colorOrder,
      invertDisplay: config.invertDisplay,
      tearingEffectPin: config.tearingEffectPin,
      touch: config.touch === false ? undefined : config.touch,
      displayClass: config.displayClass,
      capabilities: config.capabilities,
    };
  }

  if (config.width !== undefined) base.width = config.width;
  if (config.height !== undefined) base.height = config.height;
  if (config.nativeWidth !== undefined) base.nativeWidth = config.nativeWidth;
  if (config.nativeHeight !== undefined) base.nativeHeight = config.nativeHeight;
  if (config.colorFormat !== undefined) base.colorFormat = config.colorFormat;
  if (config.displayClass !== undefined) base.displayClass = config.displayClass;
  if (config.capabilities !== undefined) base.capabilities = config.capabilities;
  if (config.rotation !== undefined) base.rotation = config.rotation;
  if (config.backlight !== undefined) base.backlight = config.backlight;
  if (config.spiFrequency !== undefined) base.spiFrequency = config.spiFrequency;
  if (config.spiPins !== undefined) base.spiPins = config.spiPins;
  if (config.colorOrder !== undefined) base.colorOrder = config.colorOrder;
  if (config.invertDisplay !== undefined) base.invertDisplay = config.invertDisplay;
  if (config.tearingEffectPin !== undefined) base.tearingEffectPin = config.tearingEffectPin;
  if (config.scanlineSync !== undefined) base.scanlineSync = config.scanlineSync;
  if (config.touch === false) base.touch = undefined;
  else if (config.touch !== undefined) base.touch = config.touch;
  if (config.antialias !== undefined) base.antialias = config.antialias;
  if (config.fullscreen !== undefined) base.fullscreen = config.fullscreen;
  if (config.title !== undefined) base.title = config.title;
  if (config.icon !== undefined) base.icon = config.icon;
  // Carry scroll config through resolution so it reaches getDisplayProfile().
  if (config.scroll !== undefined) base.scroll = config.scroll;

  return {
    profile: base,
    cs: config.cs ?? 5,
    dc: config.dc ?? 21,
    rst: config.rst ?? 22,
    bus: config.bus ?? "SPI",
    address: config.address ?? 0x3C,
    reset: config.reset ?? -1,
  };
}

// ---------------------------------------------------------------------------
// Touch adapter codegen — generates C++ for built-in libraries.
// Custom adapters provide their own C++ via the TypeScript lowering.
// ---------------------------------------------------------------------------

export interface TouchAdapterCodegen {
  /** C++ #include lines for the touch library. */
  includes: string[];
  /** C++ declaration(s) for the touch object (file scope). */
  declaration: string;
  /** C++ static inline shim functions: touch_init, touch_isTouched, touch_readRaw. */
  functions: string;
}

/** Generate C++ code for a built-in touch library adapter.
 *
 *  Strategy-owned touch adapters take precedence: when the strategy's
 *  `providesTouchAdapter()` returns true and `resolveTouchAdapter` returns
 *  non-null, that codegen wins. The Arduino-ecosystem libraries
 *  (XPT2046_Touchscreen, Adafruit_TouchScreen, Adafruit_STMPE610, FT6336U)
 *  are strategy-owned — they live in @typecad/framework-arduino
 *  (src/displays/touch-adapters-codegen.ts) and ArduinoStrategy dispatches to
 *  them. Cuttlefish keeps only the framework-agnostic `sdl` path here.
 *
 *  Passing `undefined` for the strategy (or a strategy whose
 *  resolveTouchAdapter returns undefined for the given library) falls through
 *  to the `sdl` branch below; any other library without a strategy-provided
 *  adapter throws.
 */
export function generateTouchAdapter(
  touch: TouchProfile,
  strategy?: {
    providesTouchAdapter?(): boolean;
    resolveTouchAdapter?(touch: TouchProfile): TouchAdapterCodegen | undefined;
  },
): TouchAdapterCodegen {
  if (strategy?.providesTouchAdapter?.() && strategy.resolveTouchAdapter) {
    const code = strategy.resolveTouchAdapter(touch);
    if (code) return code;
  }

  if (touch.library === "sdl") {
    return {
      includes: ["#include <SDL2/SDL.h>"],
      declaration: `// SDL touch: no controller object — the event-driven mouse state`,
      // __sdl_mouse_* is declared in the SDL display adapter (sdl.ts) and written
      // by the host event loop from SDL_MOUSEBUTTONDOWN/MOTION/BUTTONUP. Reading
      // it here (instead of polling SDL_GetMouseState each frame) makes input
      // event-driven, removes a per-frame SDL query, and lets the same state feed
      // hit-testing in the wheel handler. Forward-declared here in case the touch
      // adapter is ever emitted without the display adapter (defensive).
      functions: [
        `extern uint8_t __sdl_mouse_down;`,
        `extern int16_t __sdl_mouse_x;`,
        `extern int16_t __sdl_mouse_y;`,
        `static inline void touch_init() {}`,
        `static inline bool touch_isTouched() {`,
        `  return __sdl_mouse_down != 0;`,
        `}`,
        // Scale window/logical mouse coords to framebuffer coords. In a normal
        // window the two are the same size (1:1), but in fullscreen (or any
        // HiDPI case where the window is larger than the fixed framebuffer) the
        // raw coords cover the whole window (e.g. 0..1920) while the framebuffer
        // is w_×h_ (e.g. 320×240). Without scaling, clicks past the framebuffer
        // size clamp to the corner. SDL_RenderCopy stretches the texture to fill
        // the renderer, so the inverse scale maps window→framebuffer.
        `static inline void touch_readRaw(int16_t* x, int16_t* y, int16_t* z) {`,
        `  int __ww = 0, __wh = 0; SDL_GetWindowSize(__tc_display.win, &__ww, &__wh);`,
        `  if (__ww <= 0) __ww = display_width();`,
        `  if (__wh <= 0) __wh = display_height();`,
        `  if (x) *x = static_cast<int16_t>(static_cast<int32_t>(__sdl_mouse_x) * display_width() / __ww);`,
        `  if (y) *y = static_cast<int16_t>(static_cast<int32_t>(__sdl_mouse_y) * display_height() / __wh);`,
        `  if (z) *z = 200;   // constant > default minPressure (10)`,
        `}`,
      ].join("\n"),
    };
  }

  throw new Error(
    `No touch adapter for library "${touch.library}". ` +
    `Pass a framework strategy whose resolveTouchAdapter dispatches to that driver, ` +
    `use the framework-agnostic "sdl" library, or pass { adapter: './path' } for a ` +
    `custom touch adapter.`,
  );
}
