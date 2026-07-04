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
    expect(cpp).toContain("__tc_display.put(dx, dy, 0xFF000000u | pixels[i]);");
    expect(cpp).not.toContain("__tc_display.buf[i] = 0xFF000000u | pixels[i];");
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

  it("emits the SDL event loop around ui_tick in main()", () => {
    expect(cpp).toMatch(/int main\(\)[\s\S]*while \(sdl_running\)[\s\S]*ui_tick/);
    expect(cpp).toContain("SDL_PollEvent");
  });

  it("calls ui_init, touch_init, display_init before the loop", () => {
    const mainStart = cpp.indexOf("int main()");
    expect(mainStart).toBeGreaterThanOrEqual(0);
    const mainBody = cpp.slice(mainStart, mainStart + 400);
    const uiInitIdx = mainBody.indexOf("ui_init()");
    const touchInitIdx = mainBody.indexOf("touch_init()");
    const displayInitIdx = mainBody.indexOf("display_init()");
    const loopIdx = mainBody.indexOf("while (sdl_running)");
    expect(uiInitIdx).toBeGreaterThanOrEqual(0);
    expect(touchInitIdx).toBeGreaterThan(uiInitIdx);
    expect(displayInitIdx).toBeGreaterThan(touchInitIdx);
    expect(loopIdx).toBeGreaterThan(displayInitIdx);
  });

  it("emits the SDL mouse touch shim", () => {
    expect(cpp).toContain("SDL_GetMouseState");
    expect(cpp).toContain("SDL_BUTTON_LMASK");
    expect(cpp).toContain("touch_isTouched");
    expect(cpp).toContain("touch_readRaw");
  });

  it("maps SDL mouse coords through ui_poll_touch without rotated resistive axis swapping", () => {
    expect(cpp).toContain("int16_t __tx = map(__rawX, 0, 320, 0, 320);");
    expect(cpp).toContain("int16_t __ty = map(__rawY, 0, 240, 0, 240);");
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
    expect(cpp).toContain(".prop=PROP_BG, .durationMs=120");
    expect(cpp).toContain(".prop=PROP_BG, .durationMs=100");
    expect(cpp).toContain(".prop=PROP_FG, .durationMs=0");
    expect(cpp).toContain("const uint16_t __ui_trans_count = 4;");
  });
});
