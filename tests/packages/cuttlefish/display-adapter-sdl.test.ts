import { describe, it, expect } from "vitest";
import { generateDisplayAdapter } from "../../../packages/cuttlefish/src/api/shared/display-adapter";

describe("SDL display adapter", () => {
  const a = generateDisplayAdapter({
    driver: "sdl",
    width: 320,
    height: 240,
    colorFormat: "rgb888",
    rotation: 0,
  } as any);

  it("includes SDL2", () => {
    expect(a.includes).toContain("#include <SDL2/SDL.h>");
  });
  it("aliases CuttlefishDisplayTarget to SdlGfxCanvas (shared base for canvas+target)", () => {
    expect(a.includes).toMatch(/#define CuttlefishDisplayTarget\s+SdlGfxCanvas/);
  });
  it("declares the global display object with width/height (in functions block)", () => {
    // declaration is empty; __tc_display is emitted inside the functions block
    // after the class definitions (so the type is visible).
    expect(a.functions).toMatch(/SdlGfxTarget\s+__tc_display\s*\(\s*320\s*,\s*240\s*\)/);
  });
  it("display_init calls SDL_Init and creates a window", () => {
    expect(a.functions).toContain("SDL_Init");
    expect(a.functions).toMatch(/SDL_CreateWindow/);
  });
  it("draw functions take UI_COLOR_T color", () => {
    expect(a.functions).toMatch(/display_targetDrawPixel\([^)]*UI_COLOR_T color\)/);
  });
  it("packs color as opaque RGBA8888 (0xFF000000 | color)", () => {
    expect(a.functions).toMatch(/0xFF000000/);
  });
  it("provides display_present for the event loop", () => {
    expect(a.functions).toMatch(/display_present\b/);
  });
});

import { generateTouchAdapter } from "../../../packages/cuttlefish/src/api/shared/display-profile";

describe("SDL touch library (mouse shim)", () => {
  const t = generateTouchAdapter({
    library: "sdl",
    calibration: { xMin: 0, xMax: 320, yMin: 0, yMax: 240 },
  } as any);
  it("declares an SDL include", () => {
    expect(t.includes.some((i) => i.includes("SDL"))).toBe(true);
  });
  it("touch_isTouched reads the SDL mouse left button", () => {
    expect(t.functions).toMatch(/SDL_GetMouseState[\s\S]*SDL_BUTTON_LMASK/);
  });
  it("touch_readRaw returns screen-space coords + constant z", () => {
    expect(t.functions).toMatch(/\*z = 200/);
  });
});
