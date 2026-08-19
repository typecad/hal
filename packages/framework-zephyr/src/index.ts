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

// Create-time starter debug artifacts. The `cuttlefish create` flow reads this
// optional named export off the loaded framework module (same loader pattern
// as doctor/licenses) and calls it for freshly scaffolded projects, so F5 in
// VS Code works before the first build. No-ops for non-GDB targets.
export { writeProjectDebugArtifacts } from './toolchain/debug-config.js';

// `cuttlefish doctor` — verify the installed Zephyr is reachable + inside the
// declared compat range, and preview board-target normalization. Re-exported
// under the dispatcher-facing alias `doctor` so the loader picks it up as
// mod.doctor (see framework-package.ts).
export { runDoctor as doctor } from './doctor.js';

// `cuttlefish licenses` — enumerate the Zephyr kernel + west manifest projects
// and resolve each one's SPDX license. Re-exported under the dispatcher-facing
// alias `licenses` so the loader picks it up as mod.licenses (see
// framework-package.ts). Mirrors framework-arduino's presenter.
export { runLicensesPresenter as licenses } from './licenses.js';

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
