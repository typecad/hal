// ---------------------------------------------------------------------------
// cuttlefish.config.ts — Native SDL demo configuration.
//
// Targets the host (desktop) via @typecad/framework-native. The display is an
// SDL2 window rendering true RGB888 (the rgb888 colorFormat → UI_COLOR_DEPTH 888
// in the runtime, so node colors reach the HAL at full 24-bit precision). The
// mouse is the touch source (the sdl touch library). Compile with
// `npm run compile --workspace native_demo` after installing SDL2.
//
// SDL2 prerequisite:
//   - Linux:   `sudo apt install libsdl2-dev`
//   - macOS:   `brew install sdl2`
//   - Windows: install MSYS2 (https://www.msys2.org/), then in the ucrt64
//              shell: `pacman -S mingw-w64-ucrt-x86_64-SDL2`, and ensure
//              C:\msys64\ucrt64\bin is on PATH (the toolchain probes it).
// ---------------------------------------------------------------------------

import type { TypeCADConfig } from '@typecad/hal';

const config: TypeCADConfig = {
  entry: './src/showcase.ui',
  framework: '@typecad/framework-native',
  target: 'generic',
  output: {
    outDir: './out',
  },
  // Native compile options — passed to g++/clang++ by NativeToolchain.
  // Link flags: Windows/MSYS2 ucrt64 needs -lmingw32 -lSDL2main -lSDL2 (the
  // SDL_MAIN_HANDLED define + SDL_SetMainReady in display_init handle the
  // entry-point glue). Linux/macOS can use just ['SDL2'].
  native: {
    cxxStandard: 'c++17',
    libraries: ['mingw32', 'SDL2main', 'SDL2'],
    // Link dynamically against the SDL2 DLL (installed via MSYS2 ucrt64) to
    // avoid pulling in the full set of Windows system libs that static SDL2
    // requires (-lole32 -lwinmm -lgdi32 …).
    staticLink: false,
    // The UI runtime emits some -Warray-bounds/-Wunused warnings that GCC -O2
    // promotes; suppress for the demo (the manual g++ build confirms the code
    // is correct).
    warnings: 'none',
  },
  display: {
    driver: 'sdl',
    width: 320,
    height: 240,
    colorFormat: 'rgb888',
    rotation: 0,
    // Disable AA: the antialiased asset-font path blends against a backdrop
    // read via display_canvasGetPixel, which on the SDL target reads back the
    // raw 888 framebuffer — but the AA canvas compositing assumes 565 layout.
    // The bitmap-font print() path (fontAntialias=0) renders cleanly.
    antialias: false,
    touch: {
      library: 'sdl',
      // Identity calibration: raw mouse coords are already screen-space, so the
      // ui_poll_touch map() is a 1:1 passthrough.
      calibration: { xMin: 0, xMax: 320, yMin: 0, yMax: 240 },
    },
  },
};

export default config;
