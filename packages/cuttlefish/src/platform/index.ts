// ---------------------------------------------------------------------------
// Platform strategy exports
//
// Re-exports platform strategies for use within the CLI and by consumers.
// Framework-specific strategies (e.g. ZephyrStrategy) are provided by their
// respective framework packages, which register via registerPlatformStrategy().
// ---------------------------------------------------------------------------

export type { PlatformStrategy } from '../api/shared/index.js';
export { GenericStrategy } from './generic-strategy.js';
export { resolveStrategy, registerPlatformStrategy } from './registry.js';
export type { RuntimePolyfillIR } from '../api/shared/index.js';