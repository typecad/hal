// ---------------------------------------------------------------------------
// DisplayProfile — declarative description of a display's capabilities.
//
// Lives in the project config (cuttlefish.config.ts) or in built-in framework
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

export type TouchLibrary = "XPT2046_Touchscreen" | "Adafruit_TouchScreen" | "Adafruit_STMPE610" | "FT6336U" | "sdl";

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
  backlight?: number;
  spiFrequency?: number;
  spiPins?: { mosi: number; sck: number; miso: number };
  /** Pixel color channel order expected by the panel module. Default: rgb. */
  colorOrder?: "rgb" | "bgr";
  /** Optional explicit display inversion override. */
  invertDisplay?: boolean;
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
  /** Max RGB565 scroll viewport canvas size (w×h×2 bytes) assumed to fit in heap
   *  for Mode B smooth scrolling on the target. Default ~88 KB (ESP32 no PSRAM). */
  scrollCanvasBudgetBytes?: number;
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
  scrollCanvasBudgetBytes: number;
}

/** Touch libraries treated as resistive (noisy, low-sample-rate) panels. */
const RESISTIVE_TOUCH_LIBS: ReadonlySet<string> = new Set([
  "XPT2046_Touchscreen",
  "Adafruit_TouchScreen",
]);

/** Default RGB565 scroll viewport canvas budget (~88 KB, ESP32-class SRAM). */
export const DEFAULT_SCROLL_CANVAS_BUDGET_BYTES = 88000;

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
    dragScale: s.dragScale ?? 1,
    maxOverscroll: s.maxOverscroll ?? 40,
    stiffness: s.stiffness ?? 0.5,
    edgeSnapPx: s.edgeSnapPx ?? 12,
    inputSmoothing: s.inputSmoothing ?? 0.3,
    overrideProbes: s.overrideProbes ?? true,
    debug: s.debug ?? false,
    scrollCanvasBudgetBytes: s.scrollCanvasBudgetBytes ?? DEFAULT_SCROLL_CANVAS_BUDGET_BYTES,
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
      colorFormat: config.colorFormat ?? "rgb565",
      rotation: config.rotation ?? 1,
      backlight: config.backlight,
      spiFrequency: config.spiFrequency,
      spiPins: config.spiPins,
      colorOrder: config.colorOrder,
      invertDisplay: config.invertDisplay,
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

  if (touch.library === "FT6336U") {
    const addr = touch.i2cAddress ?? 0x38;
    // I2C addresses are conventional in hex in Arduino code.
    const addrHex = "0x" + addr.toString(16).toUpperCase();
    const i2cFrequency = touch.i2cFrequency ?? 400000;
    const reset = touch.resetPin;
    const resetLines = reset
      ? [
          `  pinMode(${reset}, OUTPUT);`,
          `  digitalWrite(${reset}, LOW);`,
          `  delay(10);`,
          `  digitalWrite(${reset}, HIGH);`,
          `  delay(500);`,
        ].join("\n")
      : ``;
    return {
      includes: ["#include <Wire.h>", "#include <RAK14014_FT6336U.h>"],
      declaration: [
        `FT6336U __tc_touch(${addrHex});`,
        `static int16_t __tc_touch_cached_x = 0;`,
        `static int16_t __tc_touch_cached_y = 0;`,
        `static int16_t __tc_touch_cached_z = 0;`,
        `static uint8_t __tc_touch_cached_valid = 0;`,
      ].join("\n"),
      functions: [
        `static inline uint8_t __tc_ft6336u_read_block(uint8_t reg, uint8_t* buf, uint8_t len) {`,
        `  Wire.beginTransmission(${addrHex});`,
        `  Wire.write(reg);`,
        `  if (Wire.endTransmission(false) != 0) return 0;`,
        `  uint8_t got = Wire.requestFrom((uint8_t)${addrHex}, len);`,
        `  if (got < len) return 0;`,
        `  for (uint8_t i = 0; i < len; i++) {`,
        `    if (!Wire.available()) return 0;`,
        `    buf[i] = Wire.read();`,
        `  }`,
        `  return 1;`,
        `}`,
        `static inline void touch_init() {`,
        resetLines,
        `  __tc_touch.begin(Wire, ${addrHex});`,
        `  Wire.setClock(${i2cFrequency});`,
        `}`,
        `static inline bool touch_isTouched() {`,
        `  uint8_t buf[5] = {0, 0, 0, 0, 0};`,
        `  __tc_touch_cached_valid = 0;`,
        `  __tc_touch_cached_z = 0;`,
        `  if (!__tc_ft6336u_read_block(0x02, buf, 5)) return false;`,
        `  uint8_t count = buf[0] & 0x0F;`,
        `  if (count == 0) return false;`,
        `  __tc_touch_cached_x = (int16_t)(((uint16_t)(buf[1] & 0x0F) << 8) | buf[2]);`,
        `  __tc_touch_cached_y = (int16_t)(((uint16_t)(buf[3] & 0x0F) << 8) | buf[4]);`,
        `  __tc_touch_cached_z = 255;`,
        `  __tc_touch_cached_valid = 1;`,
        `  return true;`,
        `}`,
        `static inline void touch_readRaw(int16_t* x, int16_t* y, int16_t* z) {`,
        `  if (!__tc_touch_cached_valid) {`,
        `    (void)touch_isTouched();`,
        `  }`,
        `  if (x) *x = __tc_touch_cached_x;`,
        `  if (y) *y = __tc_touch_cached_y;`,
        `  if (z) *z = __tc_touch_cached_z;`,
        `  __tc_touch_cached_valid = 0;`,
        `}`,
      ].join("\n"),
    };
  }

  if (touch.library === "sdl") {
    return {
      includes: ["#include <SDL2/SDL.h>"],
      declaration: `// SDL touch: no controller object — the mouse is the source`,
      functions: [
        `static inline void touch_init() {}`,
        `static inline bool touch_isTouched() {`,
        `  int __mx, __my;`,
        `  return (SDL_GetMouseState(&__mx, &__my) & SDL_BUTTON_LMASK) != 0;`,
        `}`,
        `static inline void touch_readRaw(int16_t* x, int16_t* y, int16_t* z) {`,
        `  int __mx, __my;`,
        `  SDL_GetMouseState(&__mx, &__my);`,
        `  if (x) *x = (int16_t)__mx;`,
        `  if (y) *y = (int16_t)__my;`,
        `  if (z) *z = 200;   // constant > default minPressure (10)`,
        `}`,
      ].join("\n"),
    };
  }

  throw new Error(
    `Unknown touch library "${touch.library}". ` +
    `Use { adapter: './path' } for custom touch adapters, or one of: ` +
    `XPT2046_Touchscreen, Adafruit_TouchScreen, Adafruit_STMPE610, FT6336U, sdl.`,
  );
}
