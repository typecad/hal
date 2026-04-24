// ---------------------------------------------------------------------------
// Platform strategy exports
//
// Re-exports platform strategies for use within the CLI and by consumers.
// Framework strategies (Arduino, AVR, etc.) are loaded dynamically at runtime.
// ---------------------------------------------------------------------------

export { PlatformStrategy } from './platform-strategy';
export { GenericStrategy } from './generic-strategy';
export { resolveStrategy, registerPlatformStrategy } from './registry';
export type { RuntimePolyfillIR } from '../polyfill/types';