import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  // Each demo in src/ is a standalone entry — point `entry` at the one to build:
  //   01-connect.ts            minimal STA connect + print IP
  //   02-configured.ts         hostname / static IP / timeout / failure handling
  //   03-async.ts              cooperative async connect + heartbeat
  //   04-events.ts             event-callback style (no async functions)
  //   05-scan.ts               network scanner
  //   06-ap.ts                 SoftAP with options
  //   07-saved-credentials.ts  AP fallback when station connect fails
  //   08-http-get.ts           HTTP GET over the WiFi link
  //   09-https-post.ts         HTTPS GET + JSON POST (cert bundle)
  //   10-http-async.ts         cooperative HTTP send + heartbeat
  //   11-https-insecure.ts     HTTPS without cert verification (lab use)
  entry: './src/03-async.ts',

  board: 'esp32_devkitc/esp32/procpu',
  framework: '@typecad/framework-zephyr',

  output: { outDir: './out' },

  console: { baudRate: 115200 },
  zephyr: {
    kconfig: { 'CONFIG_ESP32_USE_UNSUPPORTED_REVISION': 'y' },
  },
};

export default config;
