// ---------------------------------------------------------------------------
// DisplayProfile — declarative description of a display's capabilities.
//
// Lives in the project config (cuttlefish.config.ts) or in built-in framework
// profiles. Describes everything the transpiler needs to know about the
// display hardware: dimensions, color depth, rotation, pins, touch.
//
// Adding a new display = adding a profile. No framework code changes.
//
// Touch uses an adapter pattern: either a built-in library name or a custom
// TypeScript file. The adapter provides isTouched() + read() → {x,y,z}.
// The transpiler handles calibration (raw ADC → screen pixels) and rotation.
// ---------------------------------------------------------------------------

export type TouchLibrary = "XPT2046_Touchscreen" | "Adafruit_TouchScreen" | "Adafruit_STMPE610";

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

  /** Raw ADC calibration — maps touch controller raw values to display pixels. */
  calibration: { xMin: number; xMax: number; yMin: number; yMax: number };
  /** Minimum pressure/z to register a touch (default 10). */
  minPressure?: number;
}

export interface DisplayProfile {
  driver: string;
  width: number;
  height: number;
  colorFormat: "rgb565" | "mono";
  rotation: number;
  backlight?: number;
  spiFrequency?: number;
  spiPins?: { mosi: number; sck: number; miso: number };
  touch?: TouchProfile;
  /** Enable antialiased rendering for circles, lines, rounded corners, and text
   *  unless a node opts out with font-smoothing:none.
   *  Renders AA work to offscreen GFXcanvas16 buffers, blends edges, then draws. */
  antialias?: boolean;
  /** Scroll engine capability + physics tunables. Defaults are derived from the
   *  declared touch hardware when omitted (see resolveScrollConfig). */
  scroll?: ScrollConfig;
}

export interface DisplayConfig {
  profile?: string;
  driver?: string;
  width?: number;
  height?: number;
  colorFormat?: "rgb565" | "mono";
  rotation?: number;
  backlight?: number;
  spiFrequency?: number;
  spiPins?: { mosi: number; sck: number; miso: number };
  touch?: TouchProfile | false;
  cs?: number;
  dc?: number;
  rst?: number;
  bus?: string;
  antialias?: boolean;
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

/** Input-quality axis: how raw touch becomes a smoothed scroll delta. */
export type ScrollInputTier = "capacitive" | "resistive" | "none";

/** Frame/refresh-budget axis: whether per-frame canvas repaint (incl. the
 *  rubber-band animation) is affordable. Constrained tiers get a cheaper path. */
export type ScrollRenderTier = "full" | "constrained";

/** Author-facing scroll config (all optional; defaults derived from hardware). */
export interface ScrollConfig {
  inputTier?: ScrollInputTier;
  renderTier?: ScrollRenderTier;
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
export function resolveScrollConfig(display: {
  touch?: TouchProfile | false;
  scroll?: ScrollConfig;
}): ResolvedScrollConfig {
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
      spiFrequency: config.spiFrequency,
      spiPins: config.spiPins,
      touch: config.touch === false ? undefined : config.touch,
    };
  }

  if (config.width !== undefined) base.width = config.width;
  if (config.height !== undefined) base.height = config.height;
  if (config.colorFormat !== undefined) base.colorFormat = config.colorFormat;
  if (config.rotation !== undefined) base.rotation = config.rotation;
  if (config.backlight !== undefined) base.backlight = config.backlight;
  if (config.spiFrequency !== undefined) base.spiFrequency = config.spiFrequency;
  if (config.spiPins !== undefined) base.spiPins = config.spiPins;
  if (config.touch === false) base.touch = undefined;
  else if (config.touch !== undefined) base.touch = config.touch;
  if (config.antialias !== undefined) base.antialias = config.antialias;
  // Carry scroll config through resolution so it reaches getDisplayProfile().
  if (config.scroll !== undefined) base.scroll = config.scroll;

  return {
    profile: base,
    cs: config.cs ?? 5,
    dc: config.dc ?? 21,
    rst: config.rst ?? 22,
    bus: config.bus ?? "SPI",
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

/** Generate C++ code for a built-in touch library adapter. */
export function generateTouchAdapter(touch: TouchProfile): TouchAdapterCodegen {
  const cs = touch.cs ?? 0;
  const irq = touch.irq;

  if (touch.library === "XPT2046_Touchscreen") {
    return {
      includes: ["#include <XPT2046_Touchscreen.h>"],
      declaration: `XPT2046_Touchscreen __tc_touch(${cs}${irq ? `, ${irq}` : ""});`,
      functions: [
        `static inline void touch_init() { __tc_touch.begin(); }`,
        `static inline bool touch_isTouched() { return __tc_touch.touched(); }`,
        `static inline void touch_readRaw(int16_t* x, int16_t* y, int16_t* z) {`,
        `  TS_Point __tp = __tc_touch.getPoint();`,
        `  if (x) *x = (int16_t)__tp.x;`,
        `  if (y) *y = (int16_t)__tp.y;`,
        `  if (z) *z = (int16_t)__tp.z;`,
        `}`,
      ].join("\n"),
    };
  }

  if (touch.library === "Adafruit_TouchScreen" && touch.analogPins) {
    const a = touch.analogPins;
    return {
      includes: ["#include <TouchScreen.h>"],
      declaration: `TouchScreen __tc_touch = TouchScreen(${a.xp}, ${a.yp}, ${a.xm}, ${a.ym}, ${a.rx});`,
      functions: [
        `static inline void touch_init() {}`,
        `static inline bool touch_isTouched() { return __tc_touch.isTouching(); }`,
        `static inline void touch_readRaw(int16_t* x, int16_t* y, int16_t* z) {`,
        `  TS_Point __tp = __tc_touch.getPoint();`,
        `  if (x) *x = (int16_t)__tp.x;`,
        `  if (y) *y = (int16_t)__tp.y;`,
        `  if (z) *z = (int16_t)__tp.z;`,
        `}`,
      ].join("\n"),
    };
  }

  if (touch.library === "Adafruit_STMPE610") {
    return {
      includes: ["#include <Adafruit_STMPE610.h>"],
      declaration: `Adafruit_STMPE610 __tc_touch(${cs});`,
      functions: [
        `static inline void touch_init() { __tc_touch.begin(); }`,
        `static inline bool touch_isTouched() { return __tc_touch.touched() && !__tc_touch.bufferEmpty(); }`,
        `static inline void touch_readRaw(int16_t* x, int16_t* y, int16_t* z) {`,
        `  TS_Point __tp = __tc_touch.getPoint();`,
        `  if (x) *x = (int16_t)__tp.x;`,
        `  if (y) *y = (int16_t)__tp.y;`,
        `  if (z) *z = (int16_t)__tp.z;`,
        `}`,
      ].join("\n"),
    };
  }

  throw new Error(
    `Unknown touch library "${touch.library}". ` +
    `Use { adapter: './path' } for custom touch adapters, or one of: ` +
    `XPT2046_Touchscreen, Adafruit_TouchScreen, Adafruit_STMPE610.`,
  );
}
