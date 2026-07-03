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

  it("wires the button click handler", () => {
    expect(cpp).toContain("incrementTaps");
  });
});
