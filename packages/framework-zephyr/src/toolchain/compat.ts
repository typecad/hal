// Zephyr version compatibility + board-target normalization.
//
// Two mechanisms absorb Zephyr version churn:
//  1. checkZephyrCompat() — compare the installed Zephyr version against the
//     declared range (manifest.compat.zephyr) so an incompatible Zephyr fails
//     fast with a clear message instead of a cryptic west/CMake board error.
//  2. resolveBoardTarget() — normalize the board target for the installed
//     Zephyr version. Zephyr 4.3+ rejects bare multi-core board names
//     (esp32s3_devkitc) and requires a qualified target
//     (esp32s3_devkitc/esp32s3/procpu). This rewrites stale configs at build
//     time so users don't have to regenerate them after a Zephyr upgrade.
//
// This module is intentionally pure (no chalk/ui/console) so it unit-tests
// cleanly; the doctor and the toolchain decide how to present results.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import manifest from '../framework.manifest.js';
import { discoverWest } from './west-discover.js';

// ── minimal semver ──────────────────────────────────────────────────────────

/** Parse "4.3.99" / "v4.3" / "4.3.99-rc1" → [4, 3, 99]. Undefined if unparseable. */
export function parseVersion(v: string | undefined): [number, number, number] | undefined {
  if (!v) return undefined;
  const m = v.replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return undefined;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/** Compare two version strings: -1 if a<b, 0 if equal, 1 if a>b. */
export function compareVersion(a: string, b: string): number {
  const pa = parseVersion(a) ?? [0, 0, 0];
  const pb = parseVersion(b) ?? [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    if (pa[i]! < pb[i]!) return -1;
    if (pa[i]! > pb[i]!) return 1;
  }
  return 0;
}

/**
 * Evaluate a simple range of space-separated comparators against a version.
 * Supported operators: >= <= > < =. Each comparator glues the operator to its
 * version (">=4.3", "<5.0"); spaces between comparators are AND.
 *   satisfiesRange("4.3.99", ">=4.3 <5.0") === true
 */
export function satisfiesRange(version: string, range: string): boolean {
  return range
    .trim()
    .split(/\s+/)
    .every((clause) => {
      const m = clause.replace(/\s+/g, '').match(/^(>=|<=|>|<|=)(.+)$/);
      if (!m) return true; // ignore anything that isn't a comparator
      const cmp = compareVersion(version, m[2]!);
      switch (m[1]) {
        case '>=': return cmp >= 0;
        case '<=': return cmp <= 0;
        case '>': return cmp > 0;
        case '<': return cmp < 0;
        case '=': return cmp === 0;
        default: return true;
      }
    });
}

// ── Zephyr version detection ────────────────────────────────────────────────

/**
 * Detect the installed Zephyr version from ZEPHYR_BASE/VERSION. Returns
 * undefined when ZEPHYR_BASE is unset or VERSION can't be read/parsed. Handles
 * the CMake-style file (VERSION_MAJOR = 4 / VERSION_MINOR = 3 / PATCHLEVEL = 99)
 * and a bare "4.3.99".
 */
export function detectZephyrVersion(): string | undefined {
  let base = process.env.ZEPHYR_BASE;
  if (!base) {
    // Fall back to the discovered west install's zephyrBase — covers the
    // micromamba env from the bundled Zephyr installer WITHOUT activation.
    // (micromamba run sets ZEPHYR_BASE only inside the west subprocess; this
    // makes the compat check work in the parent cuttlefish process too.)
    const install = discoverWest();
    base = install?.zephyrBase;
  }
  if (!base) return undefined;
  let content: string;
  try {
    content = readFileSync(join(base, 'VERSION'), 'utf-8');
  } catch {
    return undefined;
  }
  const field = (key: string): string | undefined => {
    const m = content.match(new RegExp(`^\\s*${key}\\s*=\\s*(\\d+)`, 'm'));
    return m ? m[1] : undefined;
  };
  const major = field('VERSION_MAJOR');
  if (major !== undefined) {
    return `${major}.${field('VERSION_MINOR') ?? 0}.${field('PATCHLEVEL') ?? 0}`;
  }
  const m = content.match(/(\d+\.\d+(?:\.\d+)?)/);
  return m ? m[1] : undefined;
}

// ── compat check ────────────────────────────────────────────────────────────

export type CompatStatus = 'ok' | 'undetectable' | 'out-of-range';

export interface CompatResult {
  version: string | undefined;
  /** Declared supported range (manifest.compat.zephyr), if any. */
  range: string | undefined;
  status: CompatStatus;
}

/**
 * Compare the detected Zephyr version against the declared compat range. Pure:
 * returns a status; the caller decides whether to throw/warn. 'ok' covers both
 * "in range" and "no range declared".
 */
export function checkZephyrCompat(version: string | undefined): CompatResult {
  const range = manifest.compat?.zephyr;
  if (!range) return { version, range, status: 'ok' };
  if (version === undefined) return { version, range, status: 'undetectable' };
  return { version, range, status: satisfiesRange(version, range) ? 'ok' : 'out-of-range' };
}

// ── board-target normalization ──────────────────────────────────────────────

/**
 * For Zephyr >=4.3, multi-core ESP32 boards require a qualified board target
 * (board/<soc>/<core>) — the bare id is rejected with "Board qualifiers … not
 * found". Map each known multi-core board id to its procpu (main app core)
 * qualified form. procpu is the core that runs application firmware; appcpu is
 * the secondary core (selected explicitly only when offloading to it).
 * Single-SoC boards (xiao_ble, rpi_pico) still normalize their bare ids on
 * 4.4, but Zephyr has signaled that bare-name normalization is going away —
 * map them too so builds do not depend on it.
 */
const QUALIFIED_TARGETS_GE_4_3: Record<string, string> = {
  esp32_devkitc: 'esp32_devkitc/esp32/procpu',
  esp32s3_devkitc: 'esp32s3_devkitc/esp32s3/procpu',
  xiao_ble: 'xiao_ble/nrf52840',
  rpi_pico: 'rpi_pico/rp2040',
};

/**
 * Normalize a board target for the installed Zephyr version. Rewrites a stale
 * bare id (esp32s3_devkitc) to the qualified form on Zephyr >=4.3; idempotent
 * if the target is already qualified. Older Zephyr and unknown boards pass
 * through unchanged.
 */
export function resolveBoardTarget(boardTarget: string, version: string | undefined): string {
  const boardId = boardTarget.split('/')[0]!;
  if (version !== undefined && satisfiesRange(version, '>=4.3')) {
    const qualified = QUALIFIED_TARGETS_GE_4_3[boardId];
    if (qualified) return qualified;
  }
  return boardTarget;
}
