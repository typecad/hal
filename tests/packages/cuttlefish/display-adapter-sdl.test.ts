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
  it("writes buffered canvas pushes into the active address window", () => {
    expect(a.functions).toContain("static int16_t __sdl_addr_x = 0;");
    expect(a.functions).toContain("static inline void display_setAddrWindow(int16_t x, int16_t y, int16_t w, int16_t h)");
    expect(a.functions).toContain("int16_t dx = (int16_t)(__sdl_addr_x + (__sdl_write_pos % (uint32_t)__sdl_addr_w));");
    expect(a.functions).toContain("__tc_display.put(dx, dy, pixels[i]);");
    expect(a.functions).not.toContain("__tc_display.buf[i] = 0xFF000000u | pixels[i];");
  });
  it("draws text with preview-matching full GFX font indexing and cursor advance", () => {
    expect(a.functions).toContain("static const uint8_t __sdl_glcdfont[1280]");
    expect(a.functions).toContain("if (ch >= 176 && ch < 255) ch++;");
    expect(a.functions).toContain("const uint8_t* glyph = &__sdl_glcdfont[(size_t)ch * 5];");
    expect(a.functions).toContain("cx += 6 * textSize;");
  });
  it("matches GFX transparent text and newline behavior", () => {
    expect(a.functions).toContain("void setTextColor(UI_COLOR_T c) { fg = (uint32_t)c; bg = fg; }");
    expect(a.functions).toContain("} else if (bgc != fgc) {");
    expect(a.functions).toContain("if (*s == '\\n') { cx = 0; cy += 8 * textSize; s++; continue; }");
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
    expect(t.functions).toMatch(/\*x = \(int16_t\)__mx/);
    expect(t.functions).toMatch(/\*y = \(int16_t\)__my/);
    expect(t.functions).toMatch(/\*z = 200/);
  });
});
