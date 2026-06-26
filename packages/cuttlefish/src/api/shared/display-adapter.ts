// ---------------------------------------------------------------------------
// Display adapter generator: produces zero-cost display-specific C++ code
// based on the display profile's driver type. The transpiler emits the
// adapter (includes + declaration + inline functions) before the runtime
// header, so the runtime never names a specific display class.
//
// To add a new display driver:
// 1. Write a generator function matching the DisplayAdapterGenerator signature
// 2. Register it: registerDisplayAdapter("driver-name", generator)
// 3. Reference it from cuttlefish.config.ts: display: { profile: "driver-name-spi" }
// ---------------------------------------------------------------------------

import type { ResolvedDisplay } from "../../ui/display-profile-store.js";

export interface DisplayAdapterCode {
  /** C++ #include lines (e.g. "#include <Adafruit_ILI9341.h>"). */
  includes: string;
  /** C++ display object declaration (e.g. "Adafruit_ILI9341 __tc_display = ..."). */
  declaration: string;
  /** C++ static inline adapter functions (display_init, display_fillScreen, etc.). */
  functions: string;
}

export type DisplayAdapterGenerator = (display: ResolvedDisplay) => DisplayAdapterCode;

// ── Adapter registry ────────────────────────────────────────────────────────
const adapters = new Map<string, DisplayAdapterGenerator>();

export function registerDisplayAdapter(driver: string, gen: DisplayAdapterGenerator): void {
  adapters.set(driver, gen);
}

export function generateDisplayAdapter(display: ResolvedDisplay): DisplayAdapterCode {
  const driver = display.driver;
  const gen = adapters.get(driver);
  if (!gen) {
    throw new Error(`No display adapter registered for driver "${driver}". ` +
      `Registered: ${[...adapters.keys()].join(", ")}.`);
  }
  return gen(display);
}

// ── ILI9341 adapter ─────────────────────────────────────────────────────────
// The first built-in adapter. Mirrors the code previously hardcoded in
// ui-emitter.ts and runtime-header.ts.

registerDisplayAdapter("ili9341", (display) => {
  const cs = display._mountCs;
  const dc = display._mountDc;
  const rst = display._mountRst;
  const rotation = display.rotation ?? 1;
  const spiFreq = display.spiFrequency;

  return {
    includes: [
      `#include <Adafruit_GFX.h>`,
      `#include <Adafruit_ILI9341.h>`,
    ].join("\n"),
    declaration: `Adafruit_ILI9341 __tc_display = Adafruit_ILI9341(${cs}, ${dc}, ${rst});`,
    functions: [
      `// --- Display adapter: ILI9341 ---`,
      ``,
      `static inline void display_init() {`,
      spiFreq
        ? `  __tc_display.begin(${spiFreq});`
        : `  __tc_display.begin();`,
      `  __tc_display.setRotation(${rotation});`,
      `  __tc_display.fillScreen(0x0000);`,
      `}`,
      ``,
      `static inline void display_fillScreen(uint16_t color) {`,
      `  __tc_display.fillScreen(color);`,
      `}`,
      ``,
      `static inline void display_startWrite() { __tc_display.startWrite(); }`,
      `static inline void display_endWrite() { __tc_display.endWrite(); }`,
      `static inline void display_setAddrWindow(int16_t x, int16_t y, int16_t w, int16_t h) {`,
      `  __tc_display.setAddrWindow(x, y, w, h);`,
      `}`,
      `static inline void display_writePixels(uint16_t* pixels, uint32_t count) {`,
      `  __tc_display.writePixels(pixels, count);`,
      `}`,
    ].join("\n"),
  };
});
