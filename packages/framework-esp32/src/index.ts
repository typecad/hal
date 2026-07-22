export { Esp32Strategy as FrameworkStrategy } from './strategy.js';
export { Toolchain } from './toolchain/index.js';

// ESP-IDF component configuration (managed + local). See
// docs/superpowers/specs/2026-07-19-framework-esp32-components-design.md
export type { Esp32FrameworkData, ScaffoldComponents, PsramMode } from './components/types.js';
export { resolveComponents } from './components/types.js';
