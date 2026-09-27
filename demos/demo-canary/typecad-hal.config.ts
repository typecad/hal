// ---------------------------------------------------------------------------
// typecad-hal.config.ts — the multi-module compile canary on native_sim.
//
// Companion to demo-mono-sim (which gates the display lowering): this one
// gates the general firmware surface — cross-module imports, GPIO, timing,
// arithmetic — so a transpiler or lowering regression that only breaks at
// C compile/link time fails CI instead of a user's first `--compile`.
// Linux-only CI target (the POSIX arch does not build on Windows).
// ---------------------------------------------------------------------------

import type { TypecadConfig } from '@typecad/cuttlefish/api';

const config: TypecadConfig = {
  entry: './src/main.ts',

  board: 'native_sim/native/64',

  framework: '@typecad/framework-zephyr',

  output: {
    outDir: './out',
  },
};

export default config;
