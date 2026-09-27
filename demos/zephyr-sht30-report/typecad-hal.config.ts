// ---------------------------------------------------------------------------
// typecad-hal.config.ts — SHT30 → HTTPS reporter (ESP32 DevKitC)
//
// Pipeline: typecad-hal build → out/src/main.cpp + overlay + prj.conf →
// west build → west flash. Console output rides the board's uart0 default.
// ---------------------------------------------------------------------------

import type { TypecadConfig } from '@typecad/cuttlefish/api';

const config: TypecadConfig = {
  entry: './src/main.ts',

  board: 'esp32_devkitc/esp32/procpu',
  framework: '@typecad/framework-zephyr',

  output: { outDir: './out' },

  zephyr: {
    // The auto-set mbedTLS heap (100 KB) plus the float-printf support the
    // %g report formats need overflows the plain ESP32's DRAM at link time.
    // 70 KB still covers a 16 KB TLS record pair plus the pinned CA.
    kconfig: { CONFIG_MBEDTLS_HEAP_SIZE: '70000' },
  },
};

export default config;
