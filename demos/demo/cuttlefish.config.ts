import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './src/main.ts',
  // Target is the ESP32-S3 on the Zephyr RTOS. The board target is the
  // esp32s3_devkitc Zephyr board (boards/espressif/esp32s3_devkitc). Zephyr 4.x
  // requires a board qualifier for this board — /esp32s3/procpu is the
  // application core (where the cuttlefish main()/loop() bridge runs). The chip
  // resolver strips the qualifier to the board id (esp32s3_devkitc).
  //
  // GPIO is lowered through devicetree: pins 0–31 against the gpio0 controller,
  // pins 32–48 against gpio1 (the SoC splits GPIO across two DT nodes), with a
  // devicetree-spec path for the BOOT button (sw0 alias).
  target: 'esp32s3',
  mcu: '@typecad/mcu-esp32s3',
  board: '@typecad/board-esp32s3',
  framework: '@typecad/framework-zephyr',
  frameworkData: { buildTarget: 'esp32s3_devkitc/esp32s3/procpu' },
  output: { outDir: './out' },
  toolchain: { type: 'west' },
  console: { baudRate: 115200, port: 'COM5' },
};

export default config;
