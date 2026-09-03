// ---------------------------------------------------------------------------
// board-catalog/index.ts — public surface of the board catalog tooling.
//
// The catalog is generated from the user's own Zephyr tree (walker over the
// tolerant devicetree reader) and lives as a machine-local overlay. There
// is no compiled-in board database.
// ---------------------------------------------------------------------------

export type { BoardDataEntry } from './types.js';
export { readBoardDts } from './dts-reader.js';
export { harvestPinconfig } from './pinconfig.js';
export type { PinconfigFacts, PinconfigAdcRoute, PinconfigDacRoute, PinconfigPwmRoute } from './pinconfig.js';
export type {
  DtsBoardFacts, DtsGpioRef, DtsGpioNode, DtsConnector, DtsPwmLed,
} from './dts-reader.js';
export {
  walkBoardCatalog,
  boardYmlSocIndex,
  boardYmlTargets,
  boardProbeMethods,
  socBusLabelsFromTree,
  zephyrVersionOf,
  gitHeadOf,
} from './walker.js';
export type {
  BoardYmlSocIndex, BoardYmlTarget, BoardCatalogProvenance, BoardCatalogWalkResult,
  VariantPin,
} from './walker.js';
export {
  GENERATOR_REV,
  isZephyrBase,
  locateZephyrBaseCheap,
  micromambaZephyrBase,
  overlayPathFor,
  readBoardCatalogOverlayFile,
  loadBoardCatalogOverlay,
  resetBoardCatalogOverlayCache,
  isOverlayStale,
  ensureFreshBoardCatalog,
  syncBoardCatalog,
  diffBoardCatalogs,
  findBoardInCatalog,
  boardRecordFingerprint,
  factsFingerprint,
  activeBoardCatalog,
  resetActiveBoardCatalog,
} from './store.js';
export type {
  BoardCatalogOverlay, BoardCatalogSyncReport, BoardCatalogSnapshot,
  BoardCatalogEnsureResult,
} from './store.js';
export {
  PINNED_ZEPHYR_MANIFEST_REV,
  PINNED_ZEPHYR_SDK_VERSION,
  ZEPHYR_INSTALL_CMD,
  sdkFingerprint,
  findToolchainSdk,
  checkZephyrSdk,
  assertZephyrSdkForCreate,
  formatZephyrSdkFound,
} from './sdk.js';
export type { SdkCheck, SdkDiscoverySource } from './sdk.js';
