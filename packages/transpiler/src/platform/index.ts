// ---------------------------------------------------------------------------
// Platform strategy exports
//
// Re-exports platform strategies for use within the CLI and by consumers.
// Framework-specific strategies (e.g. ArduinoStrategy) are provided by their
// respective framework packages, which register via registerPlatformStrategy().
// ---------------------------------------------------------------------------

export { PlatformStrategy } from './platform-strategy';
export { GenericStrategy } from './generic-strategy';
export { resolveStrategy, registerPlatformStrategy } from './registry';
export type { RuntimePolyfillIR } from '@typehal/core/shared';