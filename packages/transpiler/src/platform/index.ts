// ---------------------------------------------------------------------------
// Platform strategy exports
//
// Re-exports platform strategies for use within the CLI and by consumers.
// The ArduinoStrategy is now provided by @typehal/framework-arduino.
// ---------------------------------------------------------------------------

export { PlatformStrategy } from './platform-strategy';
export { GenericStrategy } from './generic-strategy';
export { ArduinoStrategy } from './arduino-strategy';
export { resolveStrategy, registerPlatformStrategy } from './registry';
export type { RuntimePolyfillIR } from '@typehal/core/shared';