import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './src/main.ts',
  // Target is the Seeed Studio XIAO nRF52840 on the Zephyr RTOS. The board
  // target is xiao_ble (boards/seeed/xiao_ble) — a single-core Cortex-M4F, so
  // no board qualifier is needed (unlike the ESP32 procpu/appcpu split).
  //
  // GPIO is lowered through devicetree: all pins resolve against the gpio0
  // controller. The onboard user LED (P0.26) is exposed as the DT alias `led0`
  // and is active-low (GPIO_ACTIVE_LOW in xiao_ble_common.dtsi), so .high() =
  // LED on. The user button (P0.04) is the `sw0` alias.
  board: 'xiao_ble/nrf52840',
  framework: '@typecad/framework-zephyr',
  output: {
    outDir: './out',
  },
  // Upload port for `npm run upload`. Precedence: --port flag >
  // CUTTLEFISH_PORT env var > this config — Linux/macOS users can set
  // CUTTLEFISH_PORT=/dev/ttyACM0 instead of editing the file.
  // The XIAO nRF52840 ships with a UF2 USB bootloader (no J-Link probe). When
  // the board is in UF2 mode it mounts as a USB-MSC drive and exposes no debug
  // interface, so nrfutil/jlink can't see it. The uf2 runner copies the built
  // zephyr.uf2 onto that drive — no extra tools, no probe. Put the board into
  // UF2 mode (double-tap reset) before `npm run upload`.
  zephyr: {
    runner: 'uf2',
  },
};

export default config;
