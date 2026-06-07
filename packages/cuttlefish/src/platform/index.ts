// ---------------------------------------------------------------------------
// Platform strategy exports
//
// Re-exports platform strategies for use within the CLI and by consumers.
// Framework-specific strategies (e.g. ArduinoStrategy) are provided by their
// respective framework packages, which register via registerPlatformStrategy().
// ---------------------------------------------------------------------------

export type { PlatformStrategy } from '../api/shared';
export { GenericStrategy } from './generic-strategy';
export { resolveStrategy, registerPlatformStrategy } from './registry';
export type { RuntimePolyfillIR } from '../api/shared';