const config = {
  // Entry point — the main TypeScript file to transpile
  entry: './src/main.ts',

  // Framework package — controls code generation strategy
  framework: '@typecad/framework-native',

  // Output options
  output: {
    optimize: 'speed',
    outDir: './out',
  },
};

export default config;