import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Verifies that native_demo transpiles to SDL-bearing C++. This is the
// SDL2-independent portion of the e2e (transpile + content assertions); the
// actual g++ -lSDL2 compile + run is guarded behind SDL availability and
// deferred to an SDL2-equipped host (see native_demo/README.md).
//
// Run after `npm run build --workspace native_demo` has emitted the C++.

// This file lives at <repo>/tests/packages/cuttlefish/. Walk up to the repo
// root and locate the generated showcase.cpp. Falls back to process.cwd().
function findNativeDemoCpp(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "..", "..", "..", "native_demo", "src", "out", ".build", "showcase.cpp"),
    join(process.cwd(), "native_demo", "src", "out", ".build", "showcase.cpp"),
  ];
  return candidates.find((p) => existsSync(p));
}

const NATIVE_DEMO_CPP = findNativeDemoCpp();
const skip = !NATIVE_DEMO_CPP;

// Use describe.skipIf so the suite runs when the C++ exists and is skipped
// (not failed) when native_demo hasn't been built (e.g. fresh checkout, or
// CI without the build artifact).
describe.skipIf(skip)("native_demo SDL native render (C++ emit)", () => {
  const cpp = NATIVE_DEMO_CPP ? readFileSync(NATIVE_DEMO_CPP, "utf8") : "";

  it("emits the SDL display adapter (SdlGfxTarget + SDL_Init)", () => {
    expect(cpp).toContain("SdlGfxTarget __tc_display");
    expect(cpp).toContain("SDL_Init");
    expect(cpp).toContain("SDL_CreateWindow");
  });

  it("emits display_present for the event loop", () => {
    expect(cpp).toContain("display_present");
  });

  it("emits SDL address-window writes for buffered paint canvas pushes", () => {
    expect(cpp).toContain("static int16_t __sdl_addr_x = 0;");
    expect(cpp).toContain("static inline void display_setAddrWindow(int16_t x, int16_t y, int16_t w, int16_t h)");
    // The SDL canvas stores raw RGB888 (alpha is added per-pixel in present(),
    // not baked into writePixels) so the runtime's getPixel()==fg AA coverage
    // checks match. See commit f12e977.
    expect(cpp).toContain("__tc_display.put(dx, dy, pixels[i]);");
    expect(cpp).not.toContain("0xFF000000u | pixels[i]");
  });

  it("emits the full preview-matching GFX font table for SDL text", () => {
    expect(cpp).toContain("static const uint8_t __sdl_glcdfont[1280]");
    expect(cpp).toContain("const uint8_t* glyph = &__sdl_glcdfont[(size_t)ch * 5];");
    expect(cpp).not.toContain("__sdl_glcdfont[(size_t)ch - 0x20]");
  });

  it("compiles at UI_COLOR_DEPTH 888 (true RGB888)", () => {
    expect(cpp).toContain("#define UI_COLOR_DEPTH 888");
    expect(cpp).toContain("#define UI_COLOR_T uint32_t");
  });

  it("defines UI_HIDE_OSK so the on-screen keyboard grid doesn't render on a desktop window", () => {
    // A desktop SDL window has a real keyboard (Tier A routes SDL_TEXTINPUT
    // into the editing session), so the 6×4 on-screen grid is redundant clutter.
    // The define hides the OSK *draw* only — the editing session (buffer, target,
    // commit-on-close) still runs so typing works. Hardware targets don't define
    // it (their only text-entry path is the OSK).
    expect(cpp).toContain("#define UI_HIDE_OSK 1");
  });

  it("emits the SDL event loop around ui_tick in main()", () => {
    expect(cpp).toMatch(/int main\(\)[\s\S]*while \(sdl_running\)[\s\S]*ui_tick/);
    expect(cpp).toContain("SDL_PollEvent");
  });

  // The emitter (entrypoint-synthesizer.ts) intentionally inits hardware before
  // the UI runtime: display_init → touch_init → ui_init, so the first ui_tick
  // starts from a fully initialized display/touch stack. See the comment at the
  // uiSetupStmts push site — hardware setup runs before ui_init() by design.
  it("calls display_init, touch_init, ui_init before the loop (hardware before runtime)", () => {
    const mainStart = cpp.indexOf("int main()");
    expect(mainStart).toBeGreaterThanOrEqual(0);
    const mainBody = cpp.slice(mainStart, mainStart + 400);
    const displayInitIdx = mainBody.indexOf("display_init()");
    const touchInitIdx = mainBody.indexOf("touch_init()");
    const uiInitIdx = mainBody.indexOf("ui_init()");
    const loopIdx = mainBody.indexOf("while (sdl_running)");
    expect(displayInitIdx).toBeGreaterThanOrEqual(0);
    expect(touchInitIdx).toBeGreaterThan(displayInitIdx);
    expect(uiInitIdx).toBeGreaterThan(touchInitIdx);
    expect(loopIdx).toBeGreaterThan(uiInitIdx);
  });

  it("emits the SDL mouse touch shim (event-driven via __sdl_mouse_down)", () => {
    // Feature 3: the touch shim reads __sdl_mouse_down (written by the host
    // event loop from SDL_MOUSEBUTTONDOWN/UP) instead of polling
    // SDL_GetMouseState every frame. The host loop maps SDL_BUTTON_LEFT.
    // (The wheel handler separately calls SDL_GetMouseState for the live cursor
    // position at wheel time — that's correct, so scope the no-poll assertion
    // to the touch_isTouched function body, not the whole cpp.)
    expect(cpp).toContain("__sdl_mouse_down");
    expect(cpp).toContain("SDL_BUTTON_LEFT");
    expect(cpp).toContain("touch_isTouched");
    expect(cpp).toContain("touch_readRaw");
    const touchFn = cpp.slice(cpp.indexOf("touch_isTouched"), cpp.indexOf("}", cpp.indexOf("touch_isTouched")) + 1);
    expect(touchFn).toContain("__sdl_mouse_down");
    expect(touchFn).not.toContain("SDL_GetMouseState");
  });

  it("maps SDL mouse coords 1:1 (no calibration) and clamps to live display dimensions", () => {
    // SDL mouse coords are already window/screen pixel coords — no resistive
    // calibration applies. Pass them through 1:1 and clamp to display_width()/
    // display_height() so clicks track the window size without forcing the user
    // to keep touch.calibration in sync with width/height.
    expect(cpp).toContain("int16_t __tx = __rawX;");
    expect(cpp).toContain("int16_t __ty = __rawY;");
    expect(cpp).toContain("display_width()");
    expect(cpp).toContain("display_height()");
    // Must NOT bake the calibration constants (the old behavior broke resizing).
    expect(cpp).not.toContain("map(__rawX, 0, 320");
    expect(cpp).not.toContain("int16_t __tx = map(__rawY");
  });

  it("wires the button click handler", () => {
    expect(cpp).toContain("incrementTaps");
  });

  it("emits the migrated showcase screens, navigation buttons, and image nodes", () => {
    expect(cpp).toContain('.kind=NODE_TEXT, .text="cuttlefish UI"');
    expect(cpp).toContain('.kind=NODE_BUTTON, .text="Typography >"');
    expect(cpp).toContain('.kind=NODE_BUTTON, .text="Forms >"');
    expect(cpp).toContain('.kind=NODE_TEXT, .text="Forms"');
    expect(cpp).toContain('.kind=NODE_BUTTON, .text="tap me"');
    expect(cpp).toContain(".kind=NODE_IMG");
  });

  it("emits RGB888-compatible image tables for the moved showcase assets", () => {
    expect(cpp).toContain("static const UI_COLOR_T __ui_img_imgContain_data[]");
    expect(cpp).toContain("static const UI_COLOR_T __ui_img_imgLogo_data[]");
    expect(cpp).toContain("const uint16_t __ui_image_count = 2;");
    expect(cpp).not.toContain("static const uint16_t __ui_img_imgContain_data[]");
  });

  it("emits pressed feedback transitions for showcase buttons", () => {
    expect(cpp).toContain("UITransition __ui_trans[] = {");
    // The transitionBtn still has its slower 120ms background transition.
    expect(cpp).toContain(".prop=PROP_BG, .durationMs=120");
    // Every nav/button gets the standard 100ms pressed bg + 0ms fg pair.
    expect(cpp).toContain(".prop=PROP_BG, .durationMs=100");
    expect(cpp).toContain(".prop=PROP_FG, .durationMs=0");
    // 12 buttons × 2 props (BG+FG) = 24 transitions.
    expect(cpp).toContain("const uint16_t __ui_trans_count = 24;");
  });
});
