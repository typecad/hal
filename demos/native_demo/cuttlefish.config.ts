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

import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './src/showcase.ui',
  framework: '@typecad/framework-native',
  target: 'generic',
  output: {
    outDir: './out',
  },
  // Native compile options — passed to g++/clang++ by NativeToolchain.
  // SDL2 link libraries (-lmingw32 -lSDL2main -lSDL2 on Windows/MSYS2,
  // -lSDL2 elsewhere) are auto-provided by the toolchain when the `sdl`
  // display driver is active (see framework-native native-compile.ts), so the
  // config stays portable across Windows/Linux/macOS without a
  // platform-specific libraries array.
  native: {
    cxxStandard: 'c++17',
    // Link dynamically against the SDL2 DLL (installed via MSYS2 ucrt64) to
    // avoid pulling in the full set of Windows system libs that static SDL2
    // requires (-lole32 -lwinmm -lgdi32 …). staticLink defaults to false on
    // Linux/macOS, so this is a Windows-only consideration.
    staticLink: false,
    // The UI runtime emits some -Warray-bounds/-Wunused warnings that GCC -O2
    // promotes; suppress for the demo (the manual g++ build confirms the code
    // is correct).
    warnings: 'none',
  },
  display: {
    driver: 'sdl',
    width: 640,
    height: 480,
    colorFormat: 'rgb888',
    rotation: 0,
    // Antialiased rendering for text, circles, lines, and rounded corners.
    // (An earlier workaround disabled this because the SDL canvas stored
    // 0xFF alpha in every pixel, breaking the AA coverage comparison. That's
    // fixed — the canvas now stores raw RGB888 and present() adds alpha — so
    // AA is safe and gives smooth CALIBRI font rendering.)
    antialias: true,
    themeClass: 'dark',
    touch: {
      library: 'sdl',
      // Identity calibration: raw mouse coords are already screen-space, so the
      // ui_poll_touch map() is a 1:1 passthrough.
      calibration: { xMin: 0, xMax: 320, yMin: 0, yMax: 240 },
    },
  },
};

export default config;
