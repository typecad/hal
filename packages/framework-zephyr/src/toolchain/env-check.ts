// ---------------------------------------------------------------------------
// Zephyr environment check — the shared detection behind `typecad-hal doctor`.
//
// Zephyr environment check: gather the impure
// environment facts once (west presence + version, Zephyr version, board
// existence), then reduce them to a structured result the doctor (and, later,
// the build/test gates) can present uniformly. The check is side-effect-free
// and never throws — it never installs or mutates anything.
//
// Two checks (mirroring the doctor contract):
//  1. west (the Zephyr build tool) is discoverable + responsive — the direct
//     toolchain presence. discoverWest() already confirms
//     responsiveness via `west --version`; we additionally capture the version
//     string to report it.
//  2. the configured board target exists in the Zephyr checkout
//     ($ZEPHYR_BASE/boards/) — the analog of "the required core is installed".
//
// The existing compat-range check (compat.ts) is folded in as a third check so
// the doctor reports everything through one entry point.
// ---------------------------------------------------------------------------

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { type WestInstall, discoverWest, resetWestDiscoveryCache } from './west-discover.js';
import { westSpawn } from './west-spawn.js';
import {
  detectZephyrVersion,
  checkZephyrCompat,
  resolveBoardTarget,
  type CompatStatus,
} from './compat.js';

// ---- probe data (impure facts, injectable for tests) -----------------------

/**
 * Raw west facts gathered from discovery + a `west --version` probe. Mirrors
 * probe data: `westFound` is true when a usable west install was
 * discovered (discovery itself probes responsiveness).
 */
export interface WestProbeData {
  /** A usable west install was discovered. */
  westFound: boolean;
  /** west version string if the `--version` probe parsed one, e.g. "1.3.0". */
  westVersion: string | undefined;
  /** Which discovery strategy found west, for surfacing to the user. */
  source: WestInstall['source'] | undefined;
  /** Effective ZEPHYR_BASE (env var, else a base discovery surfaced). */
  zephyrBase: string | undefined;
}

/**
 * Test-injection seam for checkZephyrEnv. Mirrors the
 * fakeProbe option so tests never spawn a real west/python.
 */
export interface CheckZephyrEnvOptions {
  /** FOR TESTS ONLY: skip the real probe and use this data directly. */
  fakeWestProbe?: WestProbeData;
  /** FOR TESTS ONLY: override the board-existence lookup. */
  fakeBoardExists?: (boardId: string, zephyrBase: string | undefined) => boolean | undefined;
}

// ---- result types ------------------------------------------------------------

export interface ZephyrEnvCheck {
  /** west (the Zephyr build tool) was discovered and responsive. */
  westFound: boolean;
  /** west version string if known, e.g. "1.3.0". */
  westVersion: string | undefined;
  /** Discovery strategy that found west, for display. */
  westSource: WestInstall['source'] | undefined;
  /** Effective ZEPHYR_BASE (env var, else a discovered base). */
  zephyrBase: string | undefined;
  /** Detected Zephyr RTOS version from $ZEPHYR_BASE/VERSION, if readable. */
  zephyrVersion: string | undefined;
  /** Declared supported range (manifest.compat.zephyr), if any. */
  compatRange: string | undefined;
  /** Result of the compat-range check against the detected version. */
  compatStatus: CompatStatus;
  /** Raw board target from typecad-hal.config.ts, if configured. */
  buildTarget: string | undefined;
  /** buildTarget normalized for the installed Zephyr version (may equal it). */
  resolvedBoardTarget: string | undefined;
  /** Does the resolved board exist in the checkout? undefined = undetermined. */
  boardTargetSupported: boolean | undefined;
}

export type ZephyrEnvOk = { ok: true; check: ZephyrEnvCheck };

export type ZephyrEnvFailure = {
  ok: false;
  reason: 'west-not-found' | 'zephyr-out-of-range' | 'board-not-supported';
  check: ZephyrEnvCheck;
  /** Human-readable lines ready to print. */
  messages: string[];
  /** Exact remediation hint, when applicable. */
  fixCommand: string | undefined;
};

export type ZephyrEnvResult = ZephyrEnvOk | ZephyrEnvFailure;

// ---- west probe (impure; isolated + cached + overridable) ------------------

let cachedProbe: WestProbeData | undefined;

/** Clear the west-probe cache (for tests). Also resets discovery cache. */
export function resetWestProbeCacheForTest(): void {
  cachedProbe = undefined;
  resetWestDiscoveryCache();
}

/**
 * Gather west facts: discover a usable install, then run `west --version`
 * through it to capture the version. Memoized for the process lifetime (west
 * installs don't move). Never throws — returns westFound:false on any failure.
 */
export function probeWestEnv(): WestProbeData {
  if (cachedProbe) return cachedProbe;

  const install = discoverWest();
  const envBase = process.env.ZEPHYR_BASE || undefined;
  if (!install) {
    const data: WestProbeData = {
      westFound: false,
      westVersion: undefined,
      source: undefined,
      zephyrBase: envBase,
    };
    cachedProbe = data;
    return data;
  }

  // Run `west --version` through the discovered install to capture the version.
  // discoverWest() already confirmed responsiveness, so a parse failure here is
  // not "unresponsive" — it just means we couldn't read a version token.
  let westVersion: string | undefined;
  try {
    const inv = westSpawn(['--version'], {
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
    });
    const r = spawnSync(inv.command, inv.args, inv.options);
    if (r.status === 0) {
      // inv.options is a generic SpawnSyncOptions (no encoding literal), so
      // coerce stdout to a string before matching.
      const out = typeof r.stdout === 'string' ? r.stdout : '';
      const m = out.match(/v?(\d+\.\d+\.\d+)/);
      westVersion = m ? m[1] : undefined;
    }
  } catch {
    // westSpawn throws only when discovery fails — but discovery already
    // succeeded (install is non-null). Defensive: treat as no version read.
    westVersion = undefined;
  }

  const data: WestProbeData = {
    westFound: true,
    westVersion,
    source: install.source,
    zephyrBase: envBase ?? install.zephyrBase,
  };
  cachedProbe = data;
  return data;
}

// ---- board existence (pure-ish fs probe) -----------------------------------

/**
 * Does `boardId` exist as a board directory in the Zephyr checkout? Checks the
 * HWMv2 vendor layout used by Zephyr 4.x: $ZEPHYR_BASE/boards/<vendor>/<boardId>.
 * Returns true/false when determinable; undefined when the base is unknown or
 * the boards/ tree can't be read (so callers never fail on an inconclusive
 * lookup — they just skip the board check).
 */
export function boardExistsInCheckout(
  boardId: string,
  zephyrBase: string | undefined,
): boolean | undefined {
  if (!zephyrBase) return undefined;
  const boards = join(zephyrBase, 'boards');
  try {
    const entries = readdirSync(boards, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && existsSync(join(boards, entry.name, boardId))) {
        return true;
      }
    }
    return false;
  } catch {
    return undefined;
  }
}

// ---- main entry point -------------------------------------------------------

/**
 * Verify the environment can build for `buildTarget`. Cheap and
 * side-effect-free: discovers west, reads the Zephyr version, checks the compat
 * range, and — when a target is configured — verifies the board exists in the
 * checkout. Reports what (if anything) is wrong.
 *
 * - If `buildTarget` is undefined/empty, the board check is skipped (not a
 *   failure), mirroring the no-build-target path.
 * - Never installs anything. Never mutates the user environment.
 * - Never throws — always returns a result. Callers decide how to react.
 *
 * `options` is for-test only (injects fake probe data / board lookup).
 */
export function checkZephyrEnv(
  buildTarget?: string,
  options?: CheckZephyrEnvOptions,
): ZephyrEnvResult {
  const probe = options?.fakeWestProbe ?? probeWestEnv();
  const boardLookup = options?.fakeBoardExists ?? boardExistsInCheckout;

  const zephyrVersion = detectZephyrVersion();
  const compat = checkZephyrCompat(zephyrVersion);
  const resolvedBoardTarget = buildTarget ? resolveBoardTarget(buildTarget, zephyrVersion) : undefined;
  const boardId = resolvedBoardTarget ? resolvedBoardTarget.split('/')[0]! : undefined;
  const boardTargetSupported =
    boardId !== undefined ? boardLookup(boardId, probe.zephyrBase) : undefined;

  const check: ZephyrEnvCheck = {
    westFound: probe.westFound,
    westVersion: probe.westVersion,
    westSource: probe.source,
    zephyrBase: probe.zephyrBase,
    zephyrVersion,
    compatRange: compat.range,
    compatStatus: compat.status,
    buildTarget,
    resolvedBoardTarget,
    boardTargetSupported,
  };

  // 1. west (the build tool) missing entirely — nothing else can run.
  if (!probe.westFound) {
    return {
      ok: false,
      reason: 'west-not-found',
      check,
      messages: [
        "west (the Zephyr build tool) was not found.",
        "  Run the typeCAD Zephyr installer, activate an existing Zephyr venv,",
        "  set ZEPHYR_BASE to a Zephyr SDK root, or `pip install west`.",
      ],
      fixCommand: undefined,
    };
  }

  // 2. west healthy but the Zephyr RTOS is outside the supported range.
  if (compat.status === 'out-of-range') {
    return {
      ok: false,
      reason: 'zephyr-out-of-range',
      check,
      messages: [
        `Zephyr ${zephyrVersion} is outside the supported range (${compat.range}) for @typecad/framework-zephyr.`,
        "  Set ZEPHYR_BASE to a compatible Zephyr checkout, or or run the bundled Zephyr installer (npx --package @typecad/framework-zephyr zephyr-installer).",
      ],
      fixCommand: undefined,
    };
  }

  // 3. west + version OK — only check the board when a target is configured and
  // the lookup was able to answer. A missing/absent target is not a board
  // problem; an inconclusive lookup (no base) is reported as a skip, not a fail.
  if (buildTarget && boardTargetSupported === false) {
    return {
      ok: false,
      reason: 'board-not-supported',
      check,
      messages: [
        `Board target '${resolvedBoardTarget}' was not found in this Zephyr checkout` +
          (probe.zephyrBase ? ` (${join(probe.zephyrBase, 'boards')}).` : '.'),
        "  Check the board id, or run `west boards` to list boards in this checkout.",
      ],
      fixCommand: 'west boards',
    };
  }

  return { ok: true, check };
}
