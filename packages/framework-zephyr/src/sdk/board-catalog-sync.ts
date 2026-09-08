// ---------------------------------------------------------------------------
// sdk/board-catalog-sync.ts — framework-side catalog orchestration.
//
// The catalog tooling (walker, overlay store, fs-only discovery) lives in
// @typecad/cuttlefish/board-catalog — the create flow needs it before any
// framework is installed. This module adds the one thing the framework owns
// — the full spawn-based west discovery cascade for an explicit
// `typecad-hal board sync` — and re-exports the store for the strategy's
// import surface.
// ----------------------------------------------------------------------------

import path from 'node:path';
import * as catalog from '@typecad/cuttlefish/board-catalog';
import { discoverWest } from '../toolchain/west-discover.js';

export type BoardCatalogSyncReport = catalog.BoardCatalogSyncReport;
export type BoardCatalogEnsureResult = catalog.BoardCatalogEnsureResult;
export type BoardCatalogOverlay = catalog.BoardCatalogOverlay;

export const {
  GENERATOR_REV,
  isZephyrBase,
  locateZephyrBaseCheap,
  overlayPathFor,
  readBoardCatalogOverlayFile,
  loadBoardCatalogOverlay,
  resetBoardCatalogOverlayCache,
  isOverlayStale,
  diffBoardCatalogs,
  boardRecordFingerprint,
  findBoardInCatalog,
  activeBoardCatalog,
  resetActiveBoardCatalog,
} = catalog;

/** Sync with the full west discovery cascade behind it (the CLI's path):
 * falls back through spawn-based discovery when the cheap fs probes find
 * nothing. */
export function syncBoardCatalog(opts: { zephyrBase?: string } = {}): catalog.BoardCatalogSyncReport {
  if (opts.zephyrBase) return catalog.syncBoardCatalog(opts);
  const cheap = catalog.locateZephyrBaseCheap();
  if (cheap) return catalog.syncBoardCatalog({ zephyrBase: cheap });
  const install = discoverWest();
  const base = install?.zephyrBase && catalog.isZephyrBase(install.zephyrBase)
    ? path.resolve(install.zephyrBase)
    : undefined;
  return catalog.syncBoardCatalog(base ? { zephyrBase: base } : {});
}

/** The build-path pre-step: refresh a stale overlay before a regen
 * (fs-only discovery — no spawns during builds). */
export function ensureFreshBoardCatalog(): catalog.BoardCatalogEnsureResult {
  return catalog.ensureFreshBoardCatalog();
}

/** Locate a Zephyr tree by any means (spawn cascade included). */
export function locateZephyrBaseFull(): string | undefined {
  const install = discoverWest();
  return install?.zephyrBase && catalog.isZephyrBase(install.zephyrBase)
    ? path.resolve(install.zephyrBase)
    : undefined;
}
