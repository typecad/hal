import type { TypehalConfig } from '@typehal/core';

const config: TypehalConfig = {
  entry: './src/main.ts',

  // No target or board needed — native framework outputs standard C++
  target: 'native',
  mcu: '@typehal/mcu-atmega328p', // Fallback mcu
  board: undefined,

  // Native C++ framework for portable desktop executables
  framework: '@typehal/framework-native',

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
