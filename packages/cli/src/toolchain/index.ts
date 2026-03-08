// ---------------------------------------------------------------------------
// Toolchain module — exports for compile/upload backends
//
// Provides a unified interface for the arduino-cli build toolchain.
// ---------------------------------------------------------------------------

// Types
export type {
  CompileError,
  CompileResult,
  UploadResult,
  CompileOptions,
  UploadOptions,
  MonitorOptions,
  Toolchain,
  ResolvedToolchainConfig,
} from './types';

// Registry
export {
  registerToolchain,
  getToolchain,
  resolveToolchain,
  listToolchains,
  findAvailableToolchain,
} from './registry';

// Implementation (self-registering on import)
import './arduino-cli';

// Re-export class for direct instantiation
export { ArduinoCliToolchain } from './arduino-cli';
