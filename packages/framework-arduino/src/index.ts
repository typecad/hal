// ---------------------------------------------------------------------------
// @typecode/framework-arduino — Arduino framework strategy
//
// Provides the ArduinoStrategy implementation for Arduino framework code
// generation. This is the main entry point for the framework-arduino package.
// ---------------------------------------------------------------------------

// Export the main strategy class
export { ArduinoStrategy } from './strategy';

// Export as FrameworkStrategy for consistency with framework package naming
export { ArduinoStrategy as FrameworkStrategy } from './strategy';

// Re-export types that consumers may need
export type { PlatformStrategy } from '@typecode/core/shared';

// Export utility functions for advanced use cases
export { renderArduinoBuiltin, tryRenderTypecodeCallStatement, extractPropertyChain, renderBoardDefinitionAccess } from './typecode-map';
export { resolveArduinoProfile } from './profile';
export type { ResolvedArduinoProfile } from './profile';
export { loadArduinoCliMetadata } from './cli-metadata';
export type { ArduinoCliMetadata } from './cli-metadata';

// Arduino library discovery and .d.ts generation
export {
  getInstalledLibraries,
  findArduinoLibrary,
  findLibraryHeader,
  findLibrarySources,
  isArduinoLibraryImport,
  mapCppTypeToTs,
  parseParameters,
  parseCppClass,
  generateArduinoLibDecl,
  tryGenerateArduinoLibDecl,
  getArduinoLibraryHeaderName,
  getArduinoLibraryClassNames,
  generateUsageDocumentation,
  clearLibraryCache,
} from './arduino-libs';
export type { ArduinoLibrary, GeneratedArduinoLib } from './arduino-libs';

// Arduino class name mapping for library imports
export { buildArduinoClassNameMap } from './arduino-class-map';
export type { ArduinoImportLike } from './arduino-class-map';

// Arduino snprintf rendering for template literal lowering
export {
  createEmissionScopeState,
  cloneEmissionScopeState,
  createChildEmissionScope,
  recordVariableType,
  inferSnprintfArg,
  buildSnprintfRenderResult,
  shouldUseSnprintfForArduinoString,
  statementNeedsSnprintf,
} from './arduino-snprintf';
export type {
  KnownVariableInfo,
  SnprintfArgRenderResult,
  SnprintfRenderResult,
  EmissionScopeState,
  SnprintfExpressionRenderer,
} from './arduino-snprintf';

// Arduino compile/upload/monitor
export {
  flattenGeneratedModulesIntoSketch,
  compileArduinoSketch,
  uploadArduinoSketch,
  monitorArduinoSketch,
} from './arduino-compile';

// Arduino polyfills
export { arduinoAsyncPolyfill, findAwaitPoints } from './polyfills/async-arduino';
export { detectSerialBeginCall, generateArduinoConsolePolyfill, generateGenericConsolePolyfill } from './polyfills/arduino-console';
export { generateStdVectorArrayPolyfill, generateStaticArrayPolyfill } from './polyfills/arduino-array';
export { generateStdStringPolyfill, generateStaticStringPolyfill } from './polyfills/arduino-string';

// Arduino debug code generation
export {
  generateSerialInitCode,
  generateBreakpointCode,
  generateLogpointCode,
} from './debug-codegen';
export type { CapturedVariable, LogMessagePart } from './debug-codegen';