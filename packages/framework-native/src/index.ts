// ---------------------------------------------------------------------------
// @typecad/framework-native — Native C++ framework package
//
// Outputs standard C++ for portable Windows/Linux desktop executables.
// Uses main(), std::cout, std::string, and std::thread-based async.
//
// Usage:
//   In TypeCAD.config.ts:
//     framework: '@typecad/framework-native'
// ---------------------------------------------------------------------------

export { NativeStrategy, NativeStrategy as FrameworkStrategy } from './strategy.js';

// Native C++ toolchain (g++/clang++ compilation)
export { NativeToolchain as Toolchain } from './native-compile.js';

// Configuration types
export type { NativeCompileConfig } from './native-config.js';
