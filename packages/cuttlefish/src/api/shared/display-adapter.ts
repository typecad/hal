// ---------------------------------------------------------------------------
// Display adapter generator: produces zero-cost display-specific C++ code
// based on the display profile's driver type. The transpiler emits the
// adapter (includes + declaration + inline functions) before the runtime
// header, so the runtime never names a specific display class.
//
// To add a new display driver:
// 1. Write a generator function matching the DisplayAdapterGenerator signature
// 2. Register it: registerDisplayAdapter("driver-name", generator)
// 3. Reference it from typecad-hal.config.ts: display: { profile: "driver-name-spi" }
// ---------------------------------------------------------------------------

import type { ResolvedDisplay } from "./display-profile.js";
import type { PlatformStrategy } from "./platform-strategy.js";

export interface DisplayAdapterCode {
  /** C++ #include lines (e.g. "#include <SDL2/SDL.h>"). */
  includes: string;
  /** C++ display object declaration (e.g. the framework-specific display object). */
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

export function generateDisplayAdapter(
  display: ResolvedDisplay,
  strategy?: Pick<PlatformStrategy, "providesDisplayAdapter" | "resolveDisplayAdapter">,
): DisplayAdapterCode {
  // Strategy-owned adapters take precedence (frameworks supply their own
  // display driver code). Falls through to cuttlefish's generic built-in
  // registry (e.g. the SDL native driver) when no strategy provides one.
  if (strategy?.providesDisplayAdapter?.() && strategy.resolveDisplayAdapter) {
    const code = strategy.resolveDisplayAdapter(display);
    if (code) return code;
  }
  const driver = display.driver;
  const gen = adapters.get(driver);
  if (!gen) {
    throw new Error(`No display adapter registered for driver "${driver}". ` +
      `Registered: ${[...adapters.keys()].join(", ")}.`);
  }
  return gen(display);
}

// ── SDL2 adapter (native desktop window, RGB888) ────────────────────────────
import { sdlAdapter } from "./display-adapters/sdl.js";
registerDisplayAdapter("sdl", sdlAdapter);

// NOTE: The Adafruit_GFX-based adapters (ili9341, st7796, ssd1309, ssd1680
// eink) were moved to @typecad/framework-arduino (src/displays/
// adafruit-adapters.ts). They are now strategy-owned: ArduinoStrategy.
// providesDisplayAdapter() returns true and resolveDisplayAdapter() dispatches
// to them by driver name. Cuttlefish keeps only the generic adapter registry
// infrastructure + the framework-agnostic sdl driver for native desktop.

