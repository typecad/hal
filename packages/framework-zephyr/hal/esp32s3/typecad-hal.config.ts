// ---------------------------------------------------------------------------
// typecad-hal.config.ts — framework-zephyr hardware HAL tests (ESP32-S3)
//
// Runs the thin-HAL expect suite against a connected ESP32-S3 devkit. The
// board's USB-UART bridge (WCH CH34x) carries BOTH the esptool flash and the
// Zephyr uart0 console, so the test identity matches the bridge
// (1A86:55D3 — unique in this rig).
// The bridge does not re-enumerate across flashes — no post-upload wait.
//
// Flashing uses west's esptool runner (the board default) on the same port.
// ---------------------------------------------------------------------------

import type { TypecadConfig } from '@typecad/cuttlefish/api';

const config: TypecadConfig = {
  entry: './hal.test.ts',

  board: 'esp32s3_devkitc/esp32s3/procpu',

  framework: '@typecad/framework-zephyr',
  output: {
    outDir: './out',
  },
  // Console stays on uart0 — the on-board USB-UART bridge (the board's own
  // devicetree `zephyr,console` choice).

  test: {
    // The CH34x bridge identity — resolves before AND after flashing (the
    // bridge never re-enumerates), unique among this rig's boards.
    usb: { vid: '0x1A86', pid: '0x55D3' },
    port: '',
    baudRate: 115200,
    timeout: 60000,
    include: ['*.test.ts'],
    // ESP32-through-bridge: the serial port's default DTR/RTS state on open
    // holds EN (reset) asserted via the devkit's auto-download circuit — the
    // board never boots while the port is open. resetAfterOpen pulses EN and
    // RELEASES both lines, booting the app under the capture.
    resetAfterOpen: true,
  },
};

export default config;
