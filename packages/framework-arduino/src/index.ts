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

// Export utility functions for advanced use cases
export { renderArduinoBuiltin, tryRenderTypehalCallStatement, extractPropertyChain, renderBoardDefinitionAccess } from './typehal-map';
export { resolveArduinoProfile } from './profile';
export type { ResolvedArduinoProfile } from './profile';
export { loadArduinoCliMetadata } from './cli-metadata';
export type { ArduinoCliMetadata } from './cli-metadata';
export type { ArduinoCompileResult, ArduinoUploadResult } from './arduino-compile';

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

// Arduino debug code generation
export {
  generateSerialInitCode,
  generateBreakpointCode,
  generateLogpointCode,
} from './debug-codegen';
export type { CapturedVariable, LogMessagePart } from './debug-codegen';