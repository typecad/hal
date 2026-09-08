// ---------------------------------------------------------------------------
// board-catalog/store.ts — the on-disk board catalog and its lifecycle.
//
// There is NO compiled-in board database. The catalog is a machine-local
// artifact generated from the Zephyr tree the user actually builds with:
//
//   <workspace>/.typecad-hal/board-catalog.json     (workspace = the dir
//   holding the zephyr checkout, so the overlay sits beside the tree it
//   describes)
//
// Lifecycle:
//   - syncBoardCatalog: walk the tree, write the overlay, report the diff
//     vs the PREVIOUS overlay (what changed in your tree).
//   - ensureFreshBoardCatalog: cheap fs-only staleness check (tree VERSION,
//     git HEAD, boards/ mtime, generator revision); re-walks only when
//     something moved. This is what makes a plain build after `west update`
//     pick up the tree's boards automatically.
//   - loadBoardCatalogOverlay / activeBoardCatalog: what every lookup
//     (boardgen, the create wizard) resolves against.
//
// Tree discovery on these paths is deliberately fs-only (env, well-known
// layouts, the installer's env-vars file) — no process spawns. The full
// spawn-based west cascade lives in framework-zephyr (explicit sync only).
// ----------------------------------------------------------------------------

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { homedir } from 'node:os';
import type { BoardDataEntry } from './types.js';
import { walkBoardCatalog, zephyrVersionOf, gitHeadOf } from './walker.js';

/** Overlay JSON schema version — bump on shape changes; loaders reject others. */
const OVERLAY_SCHEMA = 1;

/** Env var: explicit overlay file path ('' / 'off' disables overlays). */
const OVERLAY_ENV = 'TYPECAD_HAL_BOARD_CATALOG';

/** Extraction-logic revision. Bump whenever walker/dts-reader change what
 *  they extract — an overlay written by an older revision is stale even
 *  when the tree itself has not moved. History lives with the walker.
 *  18: boardgen maps EVERY declared ADC controller's routes (channels carry
 *  their owning controller; primary stays implicit).
 *  19: boardgen emits the per-family channel-setup pair (zephyr.adc.gain /
 *  zephyr.adc.reference — STM32 requires ADC_GAIN_1 + ADC_REF_INTERNAL).
 *  20: the board module re-exports the thin ADC class under its new short
 *  name (ADCChannel → ADC, matching GPIO/PWM/UART).
 *  21: DAC joins the short-name convention (DACChannel → DAC); nRF boards
 *  synthesize SAADC channels from the SoC family's AIN pad map.
 *  22: revision-qualified variant yamls resolve their .dts through the
 *  board's shared base (nrf9160dk's *_0_14_0.yaml → nrf9160dk_nrf9160.dts)
 *  instead of dropping — whole boards left the catalog silently.
 *  23: three new silicon sources — RP2 header matrices (ADC_CH/PWM_*
 *  macros), Atmel pinconfigs YAMLs (adc routes), connector io-channel-map
 *  wiring — plus per-channel ADC pinmux macro tokens.
 *  24: the remaining STM32 pinctrl spellings (H7 adc*_inp*, digitless
 *  single-unit adc_in*) + labeled PWM controller nodes (nRF psel matrix).
 *  25: four more pinctrl grammars — NXP Kinetis (FTM/ADC16), LPC CTIMER,
 *  i.MX RT (flexpwm/adc node names + in-band pad joins), GigaDevice — plus
 *  module include-dir dts roots and board-dir overlay io-channel maps.
 *  26: pinctrl name↔value cross-validation — disagreeing routes are dropped
 *  and the record carries pinctrlWarnings for generation to report.
 *  27: pinconfigs YAML ADC (GD32/Atmel/Bouffalolab, package-aware, GD32 pinmux
 *  token synthesized from the signal+pin) + the SoC gpio-controller inventory
 *  (full port sweep source) + the siliconSources coverage ledger.
 *  28: ADC/DAC device recognition widened past the adcN/dacN forms — lpadc
 *  (NXP LPADC), eadc (Nuvoton), sadc, and the adc_N / dac_N underscore forms
 *  (NXP MCX) now land in analogDevices, so the device inventory is honest.
 *  29: pinconfig DAC routes (Atmel SAM dac+vout, source normalized to the
 *  dac0 nodelabel) join the dacPins pipeline alongside the pinctrl harvest.
 *  30: STM32F1 (AFIO) grammars — the STM32F1_PINMUX value macro, the
 *  `timX_chY_pwm_out_pZ` PWM node, and the digitless `dac_outN_pZ` DAC node
 *  (source dac1).
 *  31: Atmel SAM PWM routes (pinconfig tc/tcc + wo<N> — the WO pinmux macro
 *  token synthesized from the position+peripheral+signal triple). */
export const GENERATOR_REV = 31;

// ── fs-only Zephyr tree discovery ──────────────────────────────────────────

/** True when dir looks like a Zephyr checkout (kernel header + build file). */
export function isZephyrBase(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, 'CMakeLists.txt')) &&
    fs.existsSync(path.join(dir, 'include', 'zephyr', 'kernel.h'))
  );
}

/** Well-known workspace layouts (the dir holding the zephyr/ checkout). */
function wellKnownWorkspaces(): string[] {
  const home = homedir();
  return process.platform === 'win32'
    ? [path.join(home, 'zephyrproject'), path.join(home, 'zephyr'), 'C:\\zephyrproject', 'C:\\zephyr']
    : [path.join(home, 'zephyrproject'), path.join(home, 'zephyr'), '/opt/zephyrproject', '/opt/zephyr'];
}

/** The installer-written Zephyr base of the micromamba env, fs-only. */
export function micromambaZephyrBase(): string | undefined {
  const root = process.env.MAMBA_ROOT_PREFIX || path.join(homedir(), 'micromamba');
  const envDir = path.join(root, 'envs', process.env.TYPECAD_ZEPHYR_ENV || 'zephyr');
  const candidates = process.platform === 'win32'
    ? [path.join(envDir, 'etc', 'conda', 'env-vars.ps1'), path.join(envDir, 'etc', 'conda', 'env-vars.bat')]
    : [path.join(envDir, 'etc', 'conda', 'env-vars.sh')];
  for (const f of candidates) {
    if (!fs.existsSync(f)) continue;
    try {
      const m = fs.readFileSync(f, 'utf8').match(/TYPECAD_ZEPHYR_BASE\s*=\s*"([^"]+)"/);
      if (m && isZephyrBase(m[1])) return m[1];
    } catch {
      // unreadable — try the next candidate
    }
  }
  return undefined;
}

/**
 * Locate a Zephyr tree WITHOUT spawning: $ZEPHYR_BASE, the well-known
 * workspace layouts, then the installer's env-vars file. Returns undefined
 * when none names a tree — callers decide whether that is an error
 * (explicit sync) or a skip (passive lookup / no-tree machine).
 */
export function locateZephyrBaseCheap(): string | undefined {
  // $ZEPHYR_BASE is authoritative when set: an explicit pointer that isn't a
  // tree is an error state the caller should see, not something to paper
  // over with a well-known fallback (and it makes test isolation possible
  // on machines that DO have ~/zephyrproject).
  if (process.env.ZEPHYR_BASE) {
    return isZephyrBase(process.env.ZEPHYR_BASE) ? path.resolve(process.env.ZEPHYR_BASE) : undefined;
  }
  const candidates = [
    ...wellKnownWorkspaces().map((ws) => path.join(ws, 'zephyr')),
    micromambaZephyrBase(),
  ];
  for (const c of candidates) {
    if (c && isZephyrBase(c)) return path.resolve(c);
  }
  return undefined;
}

// ── overlay shape + IO ─────────────────────────────────────────────────────

/** Tree provenance pinned into every overlay. */
export interface BoardCatalogProvenance {
  readonly zephyrBase: string;
  readonly version: string;
  readonly gitHead?: string;
  readonly boardsMtimeMs: number;
  readonly generatedAt: string;
  readonly variants: number;
}

/** A loaded overlay: the catalog + the provenance it was generated under. */
export interface BoardCatalogOverlay {
  readonly path: string;
  readonly provenance: BoardCatalogProvenance;
  readonly data: Readonly<Record<string, BoardDataEntry>>;
  /** The extraction-logic revision that wrote the file (undefined = pre-rev). */
  readonly generatorRev?: number;
  /** Walk health at sync time (undefined = pre-rev overlay): variants,
   *  withFacts, failures, droppedYamls. Persisted so drift between the
   *  tree and the catalog is diagnosable without re-walking. */
  readonly stats?: BoardCatalogWalkStats;
}

/** Walk health counters (walker → overlay → sync report). */
export interface BoardCatalogWalkStats {
  readonly variants: number;
  readonly withFacts: number;
  readonly failures: number;
  readonly droppedYamls: number;
  /** Coverage ledger (see walker's BoardCatalogWalkResult.stats.coverage). */
  readonly coverage?: {
    readonly adc: Readonly<Record<string, number>>;
    readonly pwm: Readonly<Record<string, number>>;
    readonly dac: Readonly<Record<string, number>>;
  };
}

/** A completed sync's report. */
export interface BoardCatalogSyncReport {
  readonly zephyrBase: string;
  readonly overlayPath: string;
  readonly provenance: BoardCatalogProvenance;
  readonly stats: BoardCatalogWalkStats;
  /** Identifiers present now but not in the previous overlay. */
  readonly added: readonly string[];
  /** Identifiers whose record differs from the previous overlay. */
  readonly changed: readonly string[];
  /** Identifiers the previous overlay had but this one does not. */
  readonly removed: readonly string[];
}

/** The previous-overlay snapshot for the sync diff (undefined on first sync). */
export interface BoardCatalogSnapshot {
  readonly data: Readonly<Record<string, BoardDataEntry>>;
}

/** Deterministic JSON of a record — key-sorted so field order never fakes a diff. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Diff a fresh catalog against a snapshot (the previous overlay). */
export function diffBoardCatalogs(
  boards: Readonly<Record<string, BoardDataEntry>>,
  against: BoardCatalogSnapshot | undefined,
): { added: string[]; changed: string[]; removed: string[] } {
  const previous = against?.data ?? {};
  const added: string[] = [];
  const changed: string[] = [];
  for (const [id, rec] of Object.entries(boards)) {
    const old = previous[id];
    if (!old) added.push(id);
    else if (stableStringify(old) !== stableStringify(rec)) changed.push(id);
  }
  const removed = Object.keys(previous).filter((id) => !(id in boards));
  return { added, changed, removed };
}

/** Overlay file path for a Zephyr base: the workspace dir beside the tree. */
export function overlayPathFor(zephyrBase: string): string {
  const dir = path.dirname(path.resolve(zephyrBase));
  const fresh = path.join(dir, '.typecad-hal', 'board-catalog.json');
  // One-time rename migration: adopt a pre-rename `.typecad-hal/` catalog
  // instead of rebuilding (a fresh full-tree walk) — also avoids two
  // concurrent processes racing to rebuild an absent catalog. The legacy
  // file is left in place (harmless; the mtime provenance check still
  // triggers a rebuild when the Zephyr tree moves).
  const legacy = path.join(dir, '.typecad-hal', 'board-catalog.json');
  if (!fs.existsSync(fresh) && fs.existsSync(legacy)) {
    try {
      fs.mkdirSync(path.dirname(fresh), { recursive: true });
      fs.copyFileSync(legacy, fresh);
    } catch {
      /* unreadable legacy — fall through to the normal rebuild path */
    }
  }
  return fresh;
}

/** Read + validate one overlay file. Undefined when absent/mismatched/unreadable. */
export function readBoardCatalogOverlayFile(file: string): BoardCatalogOverlay | undefined {
  let parsed: {
    schema?: number;
    generatorRev?: number;
    provenance?: BoardCatalogProvenance;
    boards?: Record<string, BoardDataEntry>;
    stats?: BoardCatalogWalkStats;
  };
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return undefined;
  }
  if (parsed.schema !== OVERLAY_SCHEMA || !parsed.provenance || !parsed.boards) return undefined;
  return {
    path: file,
    provenance: parsed.provenance,
    data: parsed.boards,
    ...(parsed.generatorRev !== undefined ? { generatorRev: parsed.generatorRev } : {}),
    ...(parsed.stats ? { stats: parsed.stats } : {}),
  };
}

let cachedOverlay: BoardCatalogOverlay | undefined | null = undefined;

/** Clear the memoized overlay lookup (tests). */
export function resetBoardCatalogOverlayCache(): void {
  cachedOverlay = undefined;
  resetActiveBoardCatalog();
}

/**
 * The active local overlay, fs-only discovery:
 *
 *   1. $TYPECAD_HAL_BOARD_CATALOG — explicit file path (''/off disables)
 *   2. The overlay beside a cheaply-located Zephyr tree
 *
 * Memoized per process. There is no compiled-in fallback: a machine with no
 * Zephyr tree and no overlay has no catalog, and callers report that
 * honestly (`typecad-hal board sync` is the fix).
 */
export function loadBoardCatalogOverlay(): BoardCatalogOverlay | undefined {
  if (cachedOverlay !== undefined) return cachedOverlay ?? undefined;
  cachedOverlay = null;
  const explicit = process.env[OVERLAY_ENV];
  if (explicit !== undefined) {
    if (explicit !== '' && explicit.toLowerCase() !== 'off') cachedOverlay = readBoardCatalogOverlayFile(explicit);
  } else {
    const zephyrBase = locateZephyrBaseCheap();
    if (zephyrBase) cachedOverlay = readBoardCatalogOverlayFile(overlayPathFor(zephyrBase));
  }
  return cachedOverlay ?? undefined;
}

/**
 * True when the overlay no longer describes its tree: the extraction
 * revision moved, the VERSION moved, the git HEAD moved, or boards/ was
 * touched after the overlay was generated. Best-effort — a git-less tarball
 * tree falls back to the mtime signal.
 */
export function isOverlayStale(overlay: BoardCatalogOverlay): boolean {
  if ((overlay.generatorRev ?? 0) !== GENERATOR_REV) return true;
  const base = overlay.provenance.zephyrBase;
  if (!isZephyrBase(base)) return true; // the tree itself is gone
  if (zephyrVersionOf(base) !== overlay.provenance.version) return true;
  const head = gitHeadOf(base);
  if (head && overlay.provenance.gitHead && head !== overlay.provenance.gitHead) return true;
  try {
    if (fs.statSync(path.join(base, 'boards')).mtimeMs > overlay.provenance.boardsMtimeMs + 1000) return true;
  } catch {
    return true;
  }
  return false;
}

/** What ensureFreshBoardCatalog ended up doing. */
export type BoardCatalogEnsureResult =
  | { status: 'fresh'; zephyrBase: string; overlayPath: string }
  | { status: 'synced'; report: BoardCatalogSyncReport }
  | { status: 'no-tree' }
  | { status: 'no-overlay'; zephyrBase: string; overlayPath: string };

/**
 * Make sure the overlay is current, walking the tree ONLY when work is
 * needed — no overlay yet (and a tree is cheaply locatable), or the
 * overlay's provenance/revision no longer matches the tree. This runs on
 * every build's board-module check; the fresh path is a handful of stat
 * calls. Returns 'no-tree' on machines without a discoverable tree — the
 * caller falls back to whatever catalog is already present.
 */
export function ensureFreshBoardCatalog(): BoardCatalogEnsureResult {
  const explicit = process.env[OVERLAY_ENV];
  if (explicit !== undefined && explicit !== '' && explicit.toLowerCase() !== 'off') {
    // An explicit overlay is authoritative — never re-walk past it.
    const overlay = readBoardCatalogOverlayFile(explicit);
    return overlay
      ? { status: 'fresh', zephyrBase: overlay.provenance.zephyrBase, overlayPath: overlay.path }
      : { status: 'no-tree' };
  }
  const zephyrBase = locateZephyrBaseCheap();
  if (!zephyrBase) return { status: 'no-tree' };
  const overlayPath = overlayPathFor(zephyrBase);
  const overlay = readBoardCatalogOverlayFile(overlayPath);
  // No overlay yet (fresh machine / first project) — create it. The walk is
  // once; every later build rides the cheap provenance check.
  if (!overlay) return { status: 'synced', report: syncBoardCatalog({ zephyrBase }) };
  if (isOverlayStale(overlay)) return { status: 'synced', report: syncBoardCatalog({ zephyrBase }) };
  return { status: 'fresh', zephyrBase, overlayPath };
}

/**
 * Walk a tree, write the overlay beside it, report the diff vs the previous
 * overlay. The diff describes what changed in YOUR tree — on the first sync
 * everything is "added".
 */
export function syncBoardCatalog(opts: { zephyrBase?: string } = {}): BoardCatalogSyncReport {
  const zephyrBase = path.resolve(opts.zephyrBase ?? locateZephyrBaseCheap() ?? '');
  if (!zephyrBase || !isZephyrBase(zephyrBase)) {
    throw new Error(
      `No Zephyr tree found to sync the board catalog from.\n` +
      `Set ZEPHYR_BASE, or pass the checkout explicitly:\n` +
      `  typecad-hal board sync <path-to-zephyr>\n` +
      `Or install one via '@typecad/zephyr-installer'.`,
    );
  }
  const overlayPath = overlayPathFor(zephyrBase);
  const previous = readBoardCatalogOverlayFile(overlayPath);
  const walk = walkBoardCatalog(zephyrBase);
  fs.mkdirSync(path.dirname(overlayPath), { recursive: true });
  fs.writeFileSync(overlayPath, JSON.stringify({
    schema: OVERLAY_SCHEMA,
    generatorRev: GENERATOR_REV,
    provenance: walk.provenance,
    boards: walk.boards,
    stats: walk.stats,
  }, null, 1), 'utf-8');
  resetBoardCatalogOverlayCache();
  return {
    zephyrBase,
    overlayPath,
    provenance: walk.provenance,
    stats: walk.stats,
    ...diffBoardCatalogs(walk.boards, previous ? { data: previous.data } : undefined),
  };
}

// ── the active catalog (listing/lookup surface) ────────────────────────────

let cachedActive: Record<string, BoardDataEntry> | undefined;

/** Test hook — drop the memo so env/discovery changes take effect. */
export function resetActiveBoardCatalog(): void {
  cachedActive = undefined;
}

/**
 * The active board catalog: the local overlay when one is discoverable,
 * else NOTHING (there is no compiled-in database — a machine without a
 * Zephyr tree has no boards until `typecad-hal board sync`). Memoized per
 * process.
 */
export function activeBoardCatalog(): Record<string, BoardDataEntry> {
  if (cachedActive) return cachedActive;
  cachedActive = { ...(loadBoardCatalogOverlay()?.data as Record<string, BoardDataEntry> | undefined) };
  return cachedActive;
}

/**
 * Fingerprint of one board record as resolved from one overlay: covers the
 * record content, the extraction revision, and the tree provenance. Board
 * modules stamp it; `typecad-hal build` recomputes it cheaply and
 * regenerates the module when it moves — a board change in the config, the
 * catalog overlay, or the Zephyr tree itself recreates the project's board
 * artifacts.
 */
export function boardRecordFingerprint(entry: BoardDataEntry, overlay?: BoardCatalogOverlay): string {
  return createHash('sha1').update(stableStringify({
    rev: GENERATOR_REV,
    version: overlay?.provenance.version ?? null,
    gitHead: overlay?.provenance.gitHead ?? null,
    record: entry,
  })).digest('hex').slice(0, 16);
}

/**
 * The suffix user facts append to the board-module fingerprint: the SAME
 * raw typecad-hal.facts.json text is hashed by the writer (boardgen, via the
 * framework) and the staleness check (config-loader), so any edit to the
 * file regenerates the module. Empty text → no suffix.
 */
export function factsFingerprint(text: string): string {
  return text ? `+${createHash('sha1').update(text).digest('hex').slice(0, 12)}` : '';
}

/**
 * Resolve a board target against a catalog: qualified identifier, bare
 * board id, or board/soc prefix. Case rules mirror west: exact case first
 * (revision qualifiers are case-sensitive), then lowercase, then prefix.
 * The single implementation of these rules — boardgen, the config-loader's
 * regen check, and the create flow all resolve through this.
 */
export function findBoardInCatalog(
  data: Readonly<Record<string, BoardDataEntry>>,
  target: string,
): BoardDataEntry | undefined {
  const raw = target.trim();
  if (data[raw]) return data[raw];
  const t = raw.toLowerCase();
  if (data[t]) return data[t];
  const exact = Object.keys(data).find((k) => k === t);
  if (exact) return data[exact];
  const prefix = Object.keys(data).find((k) => k.toLowerCase().startsWith(t + '/'));
  return prefix ? data[prefix] : undefined;
}
