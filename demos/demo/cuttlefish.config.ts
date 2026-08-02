import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './src/main.ts',
  // Target is the plain ESP32 on the Zephyr RTOS. The board target is the
  // esp32_devkitc Zephyr board (boards/espressif/esp32_devkitc). Zephyr 4.x
  // requires a board qualifier for this board — /esp32/procpu is the
  // application core (where the cuttlefish main()/loop() bridge runs). The chip
  // resolver strips the qualifier to the board id (esp32_devkitc).
  //
  // GPIO is lowered through devicetree: pins 0–31 against the gpio0 controller,
  // pins 32–39 against gpio1 (the SoC splits GPIO across two DT nodes), with a
  // devicetree-spec path for the BOOT button (sw0 alias).
  target: 'esp32',
  mcu: '@typecad/mcu-esp32',
  board: '@typecad/board-esp32-devkit',
  framework: '@typecad/framework-zephyr',
  frameworkData: { buildTarget: 'esp32_devkitc/esp32/procpu' },
  toolchain: { type: 'west' },
  console: { baudRate: 115200, port: 'COM9' },
  zephyr: {
    kconfig: { 'CONFIG_ESP32_USE_UNSUPPORTED_REVISION': 'y' },
  },
};

export default config;
