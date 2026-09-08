// ---------------------------------------------------------------------------
// @typecad/hal — Hardware test suite: ESP32-S3 devkitC
//
// The board's USB-UART bridge (WCH CH34x — 1A86:55D3) carries BOTH the
// esptool flash and the Zephyr uart0 console, so the test identity matches
// the bridge and the port never re-enumerates across flashes. Flashing uses
// west's esptool runner (the board default) on the same port.
//
// Board-honest exclusions (see the suite files for the mechanism):
//   - 08-uart: this board has ONE uart (uart0) and it IS the [TC:...]
//     protocol channel — exercising it mid-run disrupts the capture (the
//     same hard limitation the AVR boards hit). The thin framework rig
//     (framework-zephyr/hal/esp32s3) covers ESP32 UART separately.
//   - ADC runs on both SARADC units (adcPin on adc0, adcPinAlt on adc1);
//     PWM runs on the LEDC matrix (pwm/pwmAlt).
//   - 11-led skips by role: the devkitC devicetree has no led0 node.
// ---------------------------------------------------------------------------

import type { TypecadConfig } from '@typecad/cuttlefish/api';

const config: TypecadConfig = {
  entry: './tests/common/02-timing.test.ts',

  board: 'esp32s3_devkitc/esp32s3/procpu',

  framework: '@typecad/framework-zephyr',

  output: {
    outDir: './out-esp32s3',
  },

  toolchain: {
    type: 'west',
  },

  // Console stays on uart0 through the on-board bridge (the board's own
  // devicetree `zephyr,console` choice).

  test: {
    // The CH34x bridge identity — resolves before AND after flashing (the
    // bridge never re-enumerates), unique among this rig's boards. Override
    // with --port (e.g. --port COM9).
    usb: { vid: '1A86', pid: '55D3' },
    port: '',
    baudRate: 115200,
    timeout: 60000,
    // ESP32-through-bridge: the serial port's default DTR/RTS state on open
    // holds EN (reset) asserted via the devkit's auto-download circuit — the
    // board never boots while the port is open. resetAfterOpen pulses EN and
    // releases both lines, booting the app under the capture.
    resetAfterOpen: true,
    include: [
      'tests/common/*.test.ts',
      'tests/board/*.test.ts',
    ],
    exclude: [
      'tests/common/08-uart.test.ts',
    ],
  },
};

export default config;
