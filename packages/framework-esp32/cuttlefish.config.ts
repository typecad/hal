import type { CuttlefishConfig } from '@typecad/cuttlefish';

export default {
  framework: '@typecad/framework-esp32',
  frameworkData: { target: 'esp32' },
  toolchain: { type: 'idf' },
  console: { baudRate: 115200 },
} satisfies CuttlefishConfig;
