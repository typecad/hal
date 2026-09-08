// ---------------------------------------------------------------------------
// Native C++ framework — built into @typecad/cuttlefish
//
// Outputs standard C++ for portable Windows/Linux desktop executables.
// Uses main(), std::string, and std::thread-based async.
//
// Usage:
//   In typecad-hal.config.ts:
//     framework: '@typecad/framework-native'
// (The config string keeps the historical package name; the module is
//  loaded directly by framework-package.ts, no npm package involved.)
// ---------------------------------------------------------------------------

export { NativeStrategy, NativeStrategy as FrameworkStrategy } from './strategy.js';

// Native C++ toolchain (g++/clang++ compilation)
export { NativeToolchain as Toolchain } from './native-compile.js';

// Configuration types
export type { NativeCompileConfig } from './native-config.js';
