import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './src/main.ts',
  // target is the architecture family; the specific chip variant is selected
  // via frameworkData.buildTarget below. framework-esp32 handles all variants.
  target: 'esp32',
  mcu: '@typecad/mcu-esp32s3',
  board: '@typecad/board-esp32s3',
  framework: '@typecad/framework-esp32',
  // frameworkData.buildTarget selects the ESP32 variant for the idf.py
  // toolchain and chip-descriptor routing. One of: 'esp32' | 'esp32s3' |
  // 'esp32c3' | 'esp32c6'. The framework PACKAGE is always framework-esp32
  // (there is no framework-esp32s3 — the variant is data, not a package).
  frameworkData: { buildTarget: 'esp32s3' },
  output: { framework: 'esp32', optimize: 'size', outDir: './out-esp32s3' },
  toolchain: { type: 'idf' },
  // console.port is the serial port for flash + monitor, and is threaded into
  // the generated launch.json/tasks.json for F5 debugging. Change to your
  // board's USB-Serial-JTAG port (e.g. '/dev/ttyACM0' on Linux), or override
  // at the CLI with --port.
  console: { baudRate: 115200, port: 'COM10' },
};

export default config;
