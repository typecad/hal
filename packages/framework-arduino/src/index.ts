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