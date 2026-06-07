import type { CuttlefishConfig } from '@typecad/hal';

const config: CuttlefishConfig = {
  entry: './src/main.ts',

  // No target or board needed — native framework outputs standard C++
  target: 'native',
  mcu: '@typecad/mcu-atmega328p', // Fallback mcu
  board: undefined,

  // Native C++ framework for portable desktop executables
  framework: '@typecad/framework-native',

  output: {
    framework: 'bare-metal' as any,
    outDir: './out',
  },

  // Native C++ compilation customization
  native: {
    cxxStandard: 'c++17',
    warnings: 'basic',
  },
};

export default config;
