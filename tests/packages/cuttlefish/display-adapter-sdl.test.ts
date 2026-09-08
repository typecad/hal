import { describe, it, expect } from "vitest";
import { generateDisplayAdapter } from "../../../packages/cuttlefish/src/api/shared/display-adapter";
import { resolveDisplayProfile } from "../../../packages/cuttlefish/src/api/shared/display-profile";

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
    expect(a.functions).toContain("int16_t dx = static_cast<int16_t>(__sdl_addr_x + (__sdl_write_pos % static_cast<uint32_t>(__sdl_addr_w)));");
    expect(a.functions).toContain("__tc_display.put(dx, dy, pixels[i]);");
    expect(a.functions).not.toContain("__tc_display.buf[i] = 0xFF000000u | pixels[i];");
  });
  it("draws text with preview-matching full GFX font indexing and cursor advance", () => {
    expect(a.functions).toContain("static const uint8_t __sdl_glcdfont[1280]");
    expect(a.functions).toContain("if (ch >= 176 && ch < 255) ch++;");
    expect(a.functions).toContain("const uint8_t* glyph = &__sdl_glcdfont[static_cast<size_t>(ch) * 5];");
    expect(a.functions).toContain("cx += 6 * textSize;");
  });
  it("matches GFX transparent text and newline behavior", () => {
    expect(a.functions).toContain("void setTextColor(UI_COLOR_T c) { fg = static_cast<uint32_t>(c); bg = fg; }");
    expect(a.functions).toContain("} else if (bgc != fgc) {");
    expect(a.functions).toContain("if (*s == '\\n') { cx = 0; cy += 8 * textSize; s++; continue; }");
  });
  it("provides display_present for the event loop", () => {
    expect(a.functions).toMatch(/display_present\b/);
  });
});

// The SDL adapter renders to a 32-bit desktop framebuffer and hardcodes
// uint32_t/RGB888 throughout (buf, fg/bg, drawChar, present's 0xFF000000|color).
// But UI_COLOR_T is emitted from the resolved profile's colorFormat, which
// defaults to rgb565 for the generic path — so a bare `driver: 'sdl'` config
// used to emit uint16_t while the adapter expected uint32_t (type mismatch /
// garbage colors). SDL profiles must default to rgb888 so the common case
// Just Works, and an explicit rgb565 on SDL should fail loudly.
describe("SDL color depth", () => {
  it("defaults to rgb888 when colorFormat is unset (so UI_COLOR_T matches the uint32_t adapter)", () => {
    const { profile } = resolveDisplayProfile({ driver: "sdl", width: 320, height: 240 } as any, new Map());
    expect(profile.colorFormat).toBe("rgb888");
  });

  it("honors an explicit colorFormat: 'rgb888'", () => {
    const { profile } = resolveDisplayProfile({ driver: "sdl", width: 320, height: 240, colorFormat: "rgb888" } as any, new Map());
    expect(profile.colorFormat).toBe("rgb888");
  });

  it("rejects an explicit rgb565 on SDL (the adapter is RGB888-only)", () => {
    expect(() =>
      generateDisplayAdapter({ driver: "sdl", width: 320, height: 240, colorFormat: "rgb565", rotation: 0 } as any),
    ).toThrow(/rgb888|colorFormat|SDL/i);
  });

  it("creates a normal titled window by default (no fullscreen flag)", () => {
    const a = generateDisplayAdapter({ driver: "sdl", width: 320, height: 240, colorFormat: "rgb888", rotation: 0 } as never);
    expect(a.functions).toContain("SDL_WINDOW_SHOWN");
    expect(a.functions).not.toContain("SDL_WINDOW_FULLSCREEN_DESKTOP");
    expect(a.functions).not.toContain("SDL_WINDOW_FULLSCREEN");
  });

  it("creates a borderless desktop-fullscreen window when fullscreen is set", () => {
    const a = generateDisplayAdapter({ driver: "sdl", width: 320, height: 240, colorFormat: "rgb888", rotation: 0, fullscreen: true } as never);
    // SDL_WINDOW_FULLSCREEN_DESKTOP scales the fixed framebuffer to fill the
    // monitor without changing the display mode (vs SDL_WINDOW_FULLSCREEN which
    // requires a matching mode and can fail). The framebuffer stays w_×h_.
    expect(a.functions).toContain("SDL_WINDOW_FULLSCREEN_DESKTOP");
  });

  it('defaults the window title to "typecad-hal"', () => {
    const a = generateDisplayAdapter({ driver: "sdl", width: 320, height: 240, colorFormat: "rgb888", rotation: 0 } as never);
    expect(a.functions).toContain('SDL_CreateWindow("typecad-hal"');
  });

  it("uses the config title when provided", () => {
    const a = generateDisplayAdapter({ driver: "sdl", width: 320, height: 240, colorFormat: "rgb888", rotation: 0, title: "My App" } as never);
    expect(a.functions).toContain('SDL_CreateWindow("My App"');
    expect(a.functions).not.toContain('"typecad-hal"');
  });

  it("emits ui_window_set_title for runtime title changes (ui.window.setTitle)", () => {
    const a = generateDisplayAdapter({ driver: "sdl", width: 320, height: 240, colorFormat: "rgb888", rotation: 0 } as never);
    expect(a.functions).toContain("ui_window_set_title");
    expect(a.functions).toContain("SDL_SetWindowTitle");
  });

  it("emits SDL_SetWindowIcon when an icon path is configured", () => {
    const a = generateDisplayAdapter({ driver: "sdl", width: 320, height: 240, colorFormat: "rgb888", rotation: 0, icon: "assets/icon.bmp" } as never);
    expect(a.functions).toContain("SDL_SetWindowIcon");
    expect(a.functions).toContain("SDL_LoadBMP");
    expect(a.functions).toContain('"assets/icon.bmp"');
  });

  it("omits icon loading when no icon is configured", () => {
    const a = generateDisplayAdapter({ driver: "sdl", width: 320, height: 240, colorFormat: "rgb888", rotation: 0 } as never);
    expect(a.functions).not.toContain("SDL_SetWindowIcon");
    expect(a.functions).not.toContain("SDL_LoadBMP");
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
  it("touch_isTouched reads the event-driven __sdl_mouse_down flag (not polled SDL_GetMouseState)", () => {
    // Feature 3: the host event loop writes __sdl_mouse_down from
    // SDL_MOUSEBUTTONDOWN/UP; the touch shim reads that flag instead of
    // polling SDL_GetMouseState every frame.
    expect(t.functions).toContain("__sdl_mouse_down");
    expect(t.functions).not.toContain("SDL_GetMouseState");
  });
  it("touch_readRaw scales window-space mouse coords to framebuffer space (fullscreen fix)", () => {
    // In fullscreen (or any case where the window is larger than the fixed
    // framebuffer), SDL_GetMouseState returns window/logical pixels (e.g.
    // 0..1920) but the framebuffer is w_×h_ (e.g. 320×240). touch_readRaw must
    // scale by display_width()/window_width so clicks land in the right place —
    // otherwise coords past the framebuffer size clamp to the corner.
    expect(t.functions).toContain("SDL_GetWindowSize");
    expect(t.functions).toContain("display_width()");
    expect(t.functions).toContain("display_height()");
    // The scaling math: framebuffer_coord = window_coord * (display_dim / window_dim).
    // Tolerates static_cast<...>(...) wrapping from the M5-0-7 conversion.
    expect(t.functions).toMatch(/__sdl_mouse_x\)?\s*\*\s*display_width|display_width\(\)\s*\*\s*static_cast<[^>]*>\(__sdl_mouse_x/);
    expect(t.functions).toMatch(/__sdl_mouse_y\)?\s*\*\s*display_height|display_height\(\)\s*\*\s*static_cast<[^>]*>\(__sdl_mouse_y/);
  });
});
