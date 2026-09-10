import type { TypecadConfig } from '@typecad/cuttlefish/api';

// Contract-based project: board.contract.json describes a custom STM32F411
// PCB (what typecad.net exports from a schematic). No board target
// package exists for this hardware — and none is needed:
//
//   1. The contract reader narrows `@typecad/hal` (the virtual board module) to exactly the wired
//      pins (.typecad-hal/board.ts is regenerated before every build — using
//      a pin the PCB does not wire is a compile error, not a surprise at
//      runtime).
//   2. `zephyr.customBoard` makes framework-zephyr generate an out-of-tree
//      Zephyr board for the silicon under boards/typecad/typecad_f411_dev/
//      (board.yml + DTS + Kconfig), named after the build target below. The
//      console runs on the contract's UART pins (PA9/PA10, the silicon
//      default mux) at 115200.
//
// Flashing: a custom board has no probe-method table — tell west how to
// attach via zephyr.runner (openocd + any ST-Link-class SWD probe here).
const config: TypecadConfig = {
  entry: './src/main.ts',
  soc: 'stm32f411xe',
  contract: './board.contract.json',
  framework: '@typecad/framework-zephyr',
  // The custom board's name — `west build -b typecad_f411_dev` resolves to
  // the generated board in this project's boards/typecad/ directory.
  frameworkData: { buildTarget: 'typecad_f411_dev' },
  output: { outDir: './out' },
  toolchain: { type: 'west' },
  zephyr: {
    customBoard: true,
    runner: 'openocd',
    runnerArgs: ['--cmd-pre-init=reset_config none'],
  },
};

export default config;
