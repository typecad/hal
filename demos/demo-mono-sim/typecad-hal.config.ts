// ---------------------------------------------------------------------------
// typecad-hal.config.ts — Stage 2g: the whole mono lowering on native_sim's
// built-in SDL panel. The board's devicetree wires zephyr,sdl-dc itself; the
// profile flips its pixel format to MONO01 so the full-frame 1bpp adapter's
// display_write stream renders black/white in the emulator window.
//
// Compile/link gate for CI (Linux runners — the POSIX arch does not build on
// Windows). Same .ui authoring surface as demos/demo-mono-oled.
// ---------------------------------------------------------------------------

import type { TypecadConfig } from '@typecad/cuttlefish/api';

const config: TypecadConfig = {
  entry: './src/app.ui',

  board: 'native_sim/native/64',

  framework: '@typecad/framework-zephyr',
  output: {
    outDir: './out',
  },

  display: {
    profile: 'native-sim-mono',
    themeClass: 'dark',
  },
};

export default config;
