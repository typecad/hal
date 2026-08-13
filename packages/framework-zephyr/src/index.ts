// ---------------------------------------------------------------------------
// @typecad/framework-zephyr — public exports
//
// The cuttlefish loader (framework-package.ts) requires a `FrameworkStrategy`
// export (the PlatformStrategy class it instantiates) and an optional
// `Toolchain`. This package aliases ZephyrStrategy → FrameworkStrategy.
// ---------------------------------------------------------------------------

export { ZephyrStrategy as FrameworkStrategy } from './strategy.js';
export { ZephyrStrategy } from './strategy.js';
export { Toolchain } from './toolchain/index.js';

// `cuttlefish doctor` — verify the installed Zephyr is reachable + inside the
// declared compat range, and preview board-target normalization. Re-exported
// under the dispatcher-facing alias `doctor` so the loader picks it up as
// mod.doctor (see framework-package.ts).
export { runDoctor as doctor } from './doctor.js';

// Chip descriptor registry (for downstream tooling / additional boards).
export {
  chipForTarget,
  setActiveChip,
  getActiveChip,
  XIAO_BLE,
} from './chips/index.js';
export type {
  ZephyrChipDescriptor,
  ZephyrGpioDtSpec,
} from './chips/types.js';
