import type { TypecodeConfig } from '@typecode/core';

const config: TypecodeConfig = {
  entry: './src/main.ts',

  // No target or board needed — native framework outputs standard C++
  target: 'avr' as any,
  board: '' as any,

  // Native C++ framework for portable desktop executables
  framework: '@typecode/framework-native',

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
