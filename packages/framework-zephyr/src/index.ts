// ---------------------------------------------------------------------------
// @typecad/framework-zephyr — public exports
//
// The typecad-hal loader (framework-package.ts) requires a `FrameworkStrategy`
// export (the PlatformStrategy class it instantiates) and an optional
// `Toolchain`. This package aliases ZephyrStrategy → FrameworkStrategy.
// ---------------------------------------------------------------------------

export { ZephyrStrategy as FrameworkStrategy } from './strategy.js';
export { ZephyrStrategy } from './strategy.js';
export { Toolchain } from './toolchain/index.js';
export { bossacTouchReset } from './toolchain/bossac-touch.js';

// Create-time starter debug artifacts. The `typecad-hal create` flow reads this
// optional named export off the loaded framework module (same loader pattern
// as doctor/licenses) and calls it for freshly scaffolded projects, so F5 in
// VS Code works before the first build. No-ops for non-GDB targets.
export { writeProjectDebugArtifacts } from './toolchain/debug-config.js';

// `typecad-hal doctor` — verify the installed Zephyr is reachable + inside the
// declared compat range, and preview board-target normalization. Re-exported
// under the dispatcher-facing alias `doctor` so the loader picks it up as
// mod.doctor (see framework-package.ts).
export { runDoctor as doctor } from './doctor.js';

// `typecad-hal licenses` — enumerate the Zephyr kernel + west manifest projects
// and resolve each one's SPDX license. Re-exported under the dispatcher-facing
// alias `licenses` so the loader picks it up as mod.licenses (see
// framework-package.ts). Mirrors framework-arduino's presenter.
export { runLicensesPresenter as licenses } from './licenses.js';

// Chip descriptor cache (the lowering's resolved-board view; no curated
// registry — every board reconstructs from its generated manifest).
export {
  setActiveChip,
  getActiveChip,
  NO_BOARD_CHIP,
} from './chips/index.js';
export type {
  ZephyrChipDescriptor,
  ZephyrGpioDtSpec,
} from './chips/types.js';

// Board catalog sync — regenerate the local board overlay from the user's
// own Zephyr tree (`typecad-hal board sync`), so board add/change/remove
// tracks `west update` instead of cuttlefish releases.
export {
  syncBoardCatalog,
  ensureFreshBoardCatalog,
  loadBoardCatalogOverlay,
  resetBoardCatalogOverlayCache,
} from './sdk/board-catalog-sync.js';
export type {
  BoardCatalogSyncReport,
  BoardCatalogEnsureResult,
  BoardCatalogOverlay,
} from './sdk/board-catalog-sync.js';
