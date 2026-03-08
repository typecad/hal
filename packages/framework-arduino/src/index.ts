// ---------------------------------------------------------------------------
// @typecode/framework-arduino — Arduino framework strategy
//
// Re-exports ArduinoStrategy from CLI for use as a framework package.
// This allows users to specify framework: '@typecode/framework-arduino' in config.
// ---------------------------------------------------------------------------

// Re-export ArduinoStrategy as FrameworkStrategy for consistency
export { ArduinoStrategy as FrameworkStrategy } from 'typecode/platform';

// Also export as ArduinoStrategy for direct access
export { ArduinoStrategy } from 'typecode/platform';

// Export the strategy type
export type { PlatformStrategy } from 'typecode/platform';