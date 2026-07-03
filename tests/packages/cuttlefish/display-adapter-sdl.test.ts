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
  it("aliases CuttlefishDisplayTarget to SdlGfxTarget", () => {
    expect(a.includes).toMatch(/#define CuttlefishDisplayTarget\s+SdlGfxTarget/);
  });
  it("declares the global display object with width/height", () => {
    expect(a.declaration).toMatch(/SdlGfxTarget\s+__tc_display\s*\(\s*320\s*,\s*240\s*\)/);
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
