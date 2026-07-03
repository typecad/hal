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
  // SDL2 link flags: -lSDL2 (Linux/macOS). On Windows/MSYS2 ucrt64 the set is
  // -lmingw32 -lSDL2main -lSDL2; if the bare `['SDL2']` fails to link there,
  // expand libraries and add libraryPaths as documented in the README.
  native: {
    cxxStandard: 'c++17',
    libraries: ['SDL2'],
    warnings: 'all',
  },
  display: {
    driver: 'sdl',
    width: 320,
    height: 240,
    colorFormat: 'rgb888',
    rotation: 0,
    touch: {
      library: 'sdl',
      // Identity calibration: raw mouse coords are already screen-space, so the
      // ui_poll_touch map() is a 1:1 passthrough.
      calibration: { xMin: 0, xMax: 320, yMin: 0, yMax: 240 },
    },
  },
};

export default config;
