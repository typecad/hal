// ---------------------------------------------------------------------------
// @typehal/framework-arduino — Arduino framework strategy
//
// Provides the ArduinoStrategy implementation for Arduino framework code
// generation. This is the main entry point for the framework-arduino package.
// ---------------------------------------------------------------------------

// Export the main strategy class
export { ArduinoStrategy } from './strategy';

// Export as FrameworkStrategy for consistency with framework package naming
export { ArduinoStrategy as FrameworkStrategy } from './strategy';

// Re-export types that consumers may need
export type { PlatformStrategy } from '@typehal/core/shared';

// Export the profile resolver for configuration inspection
export { resolveArduinoProfile } from './profile';
export type { ResolvedArduinoProfile } from './profile';

// Export CLI metadata loader
export { loadArduinoCliMetadata } from './cli-metadata';
export type { ArduinoCliMetadata } from './cli-metadata';

// Deprecated compile result type aliases (use CompileResult/UploadResult from core)
export type { ArduinoCompileResult, ArduinoUploadResult } from './arduino-compile';

// FQBN utility
export { toArchitectureFromFqbn } from './arduino-compile';

// Arduino compile/upload/monitor
export {
  flattenGeneratedModulesIntoSketch,
  compileArduinoSketch,
  uploadArduinoSketch,
  monitorArduinoSketch,
} from './arduino-compile';

// Toolchain object for the framework registry
import { flattenGeneratedModulesIntoSketch, compileArduinoSketch, uploadArduinoSketch, monitorArduinoSketch } from './arduino-compile';
export const Toolchain = {
  prepare: flattenGeneratedModulesIntoSketch,
  compile: (options: any) => compileArduinoSketch(options.sourcePath, options.buildTarget),
  upload: (options: any) => uploadArduinoSketch(options.outputDir, options.buildTarget, options.port),
  monitor: (options: any) => monitorArduinoSketch(options.port, options.baud),
};

// Arduino debug code generation
export {
  generateSerialInitCode,
  generateBreakpointCode,
  generateLogpointCode,
} from './debug-codegen';
export type { CapturedVariable, LogMessagePart } from './debug-codegen';

// Library discovery — consumed by the transpiler's dynamic module loader
export { isArduinoLibraryImport as isFrameworkLibraryImport, getArduinoLibraryHeaderName as getFrameworkLibraryHeaderName } from './arduino-libs';
export { tryGenerateArduinoLibDecl as tryGenerateLibDecl } from './arduino-libs';
export { buildArduinoClassNameMap as buildClassNameMap } from './arduino-class-map';
