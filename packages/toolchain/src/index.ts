// ---------------------------------------------------------------------------
// index.ts — Barrel exports for @typecode/toolchain
//
// Re-exports all public APIs from the toolchain package.
// ---------------------------------------------------------------------------

// Types
export type {
  Toolchain,
  ToolchainConfig,
  CompileOptions,
  CompileResult,
  CompileError,
  UploadOptions,
  UploadResult,
  MonitorOptions,
  PortInfo,
} from './types.js';

// Registry functions
export {
  registerToolchain,
  getToolchain,
  getRegisteredToolchains,
  findAvailableToolchain,
  resolveToolchain,
  isToolchainAvailable,
} from './registry.js';

// Toolchain implementations
export { ArduinoCliToolchain, flattenSketch } from './arduino-cli.js';
export type { ArduinoCliToolchainOptions } from './arduino-cli.js';

export { PlatformioToolchain } from './platformio.js';
export type { PlatformioToolchainOptions } from './platformio.js';