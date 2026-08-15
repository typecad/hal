import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './src/main.ts',
  // target is the architecture family; the specific chip variant is selected
  // via frameworkData.buildTarget below.
  target: 'avr',
  mcu: '@typecad/mcu-atmega328p',
  board: '@typecad/board-arduino-uno',
  framework: '@typecad/framework-arduino',
  frameworkData: { buildTarget: 'arduino:avr:uno' },
  output: { framework: 'arduino', optimize: 'size', outDir: './out-avr' },
  toolchain: { type: 'arduino-cli' },
  // console.port is the serial port for flash + monitor, and is threaded into
  // the generated launch.json/tasks.json for F5 debugging. Change to your
  // board's USB-Serial-JTAG port (e.g. '/dev/ttyACM0' on Linux), or override
  // at the CLI with --port.
  console: { baudRate: 115200, port: 'COM8' },
};

export default config;
