// ---------------------------------------------------------------------------
// board-catalog-sync.test.ts — the local board catalog overlay: sync writes
// it beside the user's Zephyr tree, lookups prefer it over the compiled-in
// pack (replace, not merge), and staleness gates the auto-refresh on
// `cuttlefish board regen`.
// ----------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {
  overlayPathFor,
  syncBoardCatalog,
  loadBoardCatalogOverlay,
  resetBoardCatalogOverlayCache,
  isOverlayStale,
  ensureFreshBoardCatalog,
  diffBoardCatalogs,
  resetActiveBoardCatalog,
} from '../../../packages/cuttlefish/src/board-catalog/store';
import { findBoardData } from '../../../packages/framework-zephyr/src/boardgen';
import { activeBoardCatalog } from '../../../packages/cuttlefish/src/board-catalog/store';

/** A minimal but real fixture tree the cheap discovery accepts. */
function fixtureTree(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-sync-'));
  const zephyr = path.join(root, 'zephyr');
  fs.mkdirSync(path.join(zephyr, 'include', 'zephyr'), { recursive: true });
  fs.writeFileSync(path.join(zephyr, 'CMakeLists.txt'), '# fixture\n');
  fs.writeFileSync(path.join(zephyr, 'include', 'zephyr', 'kernel.h'), '# fixture\n');
  fs.writeFileSync(path.join(zephyr, 'VERSION'), 'VERSION_MAJOR = 4\nVERSION_MINOR = 9\nPATCHLEVEL = 1\n');
  // A git HEAD from the start, so provenance records one and the
  // staleness test can move it (west update moves HEAD on every checkout).
  fs.mkdirSync(path.join(zephyr, '.git', 'refs', 'heads'), { recursive: true });
  fs.writeFileSync(path.join(zephyr, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(zephyr, '.git', 'refs', 'heads', 'main'), '0123456789abcdef0123456789abcdef01234567\n');
  const board = path.join(zephyr, 'boards', 'acme', 'future_board');
  fs.mkdirSync(board, { recursive: true });
  fs.writeFileSync(path.join(board, 'board.yml'), 'socs:\n  - name: acme_soc\n');
  fs.writeFileSync(path.join(board, 'future_board.yaml'), 'identifier: future_board\nname: Future Board\n');
  fs.writeFileSync(path.join(board, 'future_board.dts'), [
    '/ {',
    '    leds {',
    '        compatible = "gpio-leds";',
    '        user_led: led_0 {',
    '            gpios = <&gpio0 9 GPIO_ACTIVE_HIGH>;',
    '        };',
    '    };',
    '    aliases {',
    '        led0 = &user_led;',
    '    };',
    '};',
    '',
  ].join('\n'));
  return zephyr;
}

describe('board-catalog-sync', () => {
  let zephyr: string;
  let workspace: string;
  let overlayPath: string;
  let savedEnv: string | undefined;

  beforeEach(() => {
    zephyr = fixtureTree();
    workspace = path.dirname(zephyr);
    overlayPath = overlayPathFor(zephyr);
    savedEnv = process.env.CUTTLEFISH_BOARD_CATALOG;
    // Pin cheap discovery to the fixture tree so a real ~/zephyrproject on
    // the dev machine can never leak into these tests.
    process.env.ZEPHYR_BASE = zephyr;
    delete process.env.CUTTLEFISH_BOARD_CATALOG;
    resetBoardCatalogOverlayCache();
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.CUTTLEFISH_BOARD_CATALOG;
    else process.env.CUTTLEFISH_BOARD_CATALOG = savedEnv;
    delete process.env.ZEPHYR_BASE;
    resetBoardCatalogOverlayCache();
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('places the overlay in the workspace beside the tree', () => {
    expect(overlayPathFor('C:/some/workspace/zephyr')).toBe(
      path.join('C:/some/workspace', '.cuttlefish', 'board-catalog.json'),
    );
  });

  it('syncs the tree, writes the overlay, and diffs against the previous overlay', () => {
    const report = syncBoardCatalog({ zephyr });
    expect(fs.existsSync(overlayPath)).toBe(true);
    expect(report.zephyrBase).toBe(path.resolve(zephyr));
    expect(report.provenance.version).toBe('4.9.1');
    expect(report.provenance.variants).toBe(1);
    // First sync into this workspace: everything added, nothing removed.
    expect(report.added).toContain('future_board/acme_soc');
    expect(report.removed).toEqual([]);
    expect(report.changed).toEqual([]);
  });

  it('loads the overlay after sync and it is not stale', () => {
    syncBoardCatalog({ zephyr });
    const overlay = loadBoardCatalogOverlay();
    expect(overlay).toBeDefined();
    expect(overlay!.path).toBe(overlayPath);
    expect(Object.keys(overlay!.data)).toEqual(['future_board/acme_soc']);
    expect(isOverlayStale(overlay!)).toBe(false);
  });

  it('findBoardData resolves against the overlay — the only catalog', () => {
    // Before sync: no overlay exists for the fixture tree → no catalog at
    // all (there is no compiled-in pack to fall back to), and lookups say
    // so instead of pretending.
    expect(() => findBoardData('future_board/acme_soc')).toThrow(/No board catalog/);

    syncBoardCatalog({ zephyr });
    resetBoardCatalogOverlayCache();

    // After sync: the tree's boards resolve with their facts…
    const future = findBoardData('future_board');
    expect(future?.identifier).toBe('future_board/acme_soc');
    expect(future?.led).toMatchObject({ controller: 'gpio0', pin: 9 });
    // …and boards from OTHER trees do not (the overlay describes THIS tree).
    expect(findBoardData('xiao_ble/nrf52840')).toBeUndefined();
  });

  it('an explicit CUTTLEFISH_BOARD_CATALOG path overrides discovery', () => {
    syncBoardCatalog({ zephyr });
    process.env.CUTTLEFISH_BOARD_CATALOG = overlayPath;
    resetBoardCatalogOverlayCache();
    expect(loadBoardCatalogOverlay()?.path).toBe(overlayPath);
    // 'off' disables overlays entirely
    process.env.CUTTLEFISH_BOARD_CATALOG = 'off';
    resetBoardCatalogOverlayCache();
    expect(loadBoardCatalogOverlay()).toBeUndefined();
  });

  it('marks the overlay stale when the tree moves (VERSION, git, boards mtime)', () => {
    syncBoardCatalog({ zephyr });
    const overlay = loadBoardCatalogOverlay()!;

    // Bump VERSION → stale.
    fs.writeFileSync(path.join(zephyr, 'VERSION'), 'VERSION_MAJOR = 5\nVERSION_MINOR = 0\nPATCHLEVEL = 0\n');
    expect(isOverlayStale(overlay)).toBe(true);
    // Re-sync under the new version → fresh again.
    syncBoardCatalog({ zephyr });
    resetBoardCatalogOverlayCache();
    expect(isOverlayStale(loadBoardCatalogOverlay()!)).toBe(false);

    // Move git HEAD (loose ref) → stale.
    fs.writeFileSync(path.join(zephyr, '.git', 'refs', 'heads', 'main'), 'ffffffffffffffffffffffffffffffffffffffff\n');
    expect(isOverlayStale(loadBoardCatalogOverlay()!)).toBe(true);
  });

  it('ensureFreshBoardCatalog walks only when there is work to do', () => {
    // No overlay yet → the walk creates it (first build on a new machine).
    expect(ensureFreshBoardCatalog().status).toBe('synced');
    expect(fs.existsSync(overlayPath)).toBe(true);

    // Fresh overlay: no walk (the build-path cheap check).
    syncBoardCatalog({ zephyr });
    resetBoardCatalogOverlayCache();
    expect(ensureFreshBoardCatalog().status).toBe('fresh');
    // A second call must not rewrite the file (no walk when fresh).
    const before = fs.statSync(overlayPath).mtimeMs;
    const fresh = ensureFreshBoardCatalog();
    expect(fresh.status).toBe('fresh');
    expect(fs.statSync(overlayPath).mtimeMs).toBe(before);

    // Tree moved ahead → ensure walks and reports synced.
    fs.writeFileSync(path.join(zephyr, 'VERSION'), 'VERSION_MAJOR = 5\nVERSION_MINOR = 0\nPATCHLEVEL = 0\n');
    const synced = ensureFreshBoardCatalog();
    expect(synced.status).toBe('synced');
    resetBoardCatalogOverlayCache();
    expect(isOverlayStale(loadBoardCatalogOverlay()!)).toBe(false);
  });

  it('diffs ignore undefined-valued optionals and key order', () => {
    // Regression: the in-memory walk records carry undefined-valued
    // optionals that JSON drops on write — those must never count as a
    // change against the previous overlay. The baseline is the checked-in
    // fixture catalog (this suite's beforeEach unsets the env, so restore
    // it explicitly for the read).
    const fixturePath = fileURLToPath(new URL('../../fixtures/board-catalog.overlay.json', import.meta.url));
    process.env.CUTTLEFISH_BOARD_CATALOG = fixturePath;
    resetActiveBoardCatalog();
    resetBoardCatalogOverlayCache();
    const pack = activeBoardCatalog();
    const id = 'xiao_ble/nrf52840';
    const rest = Object.fromEntries(Object.entries(pack).filter(([k]) => k !== id));
    const same = diffBoardCatalogs({ ...rest, [id]: pack[id] }, { data: rest });
    expect(same.changed).toHaveLength(0);
    expect(same.added).toEqual([id]);
    expect(same.removed).toHaveLength(0);

    const altered = { ...pack[id], name: 'not the same board' };
    const changed = diffBoardCatalogs({ ...rest, [id]: altered }, { data: pack });
    expect(changed.changed).toEqual([id]);
  });
});
