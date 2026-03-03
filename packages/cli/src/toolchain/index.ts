// ---------------------------------------------------------------------------
// Toolchain module — exports for compile/upload backends
//
// Provides a unified interface for different build toolchains
// (arduino-cli, platformio).
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

// Implementations (self-registering on import)
import './arduino-cli';
import './platformio';

// Re-export classes for direct instantiation
export { ArduinoCliToolchain } from './arduino-cli';
export { PlatformioToolchain } from './platformio';