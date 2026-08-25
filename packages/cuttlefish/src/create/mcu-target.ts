// ---------------------------------------------------------------------------
// MCU-only create-target resolution
//
// Shared logic for `cuttlefish create --mcu <id>` and the wizard's bare-MCU
// entries: framework narrowing (Zephyr needs the package's silicon zephyr
// block), the Zephyr board decision (generated custom board vs any upstream
// board whose SoC matches, from the exhaustive snapshot), the default
// qualified `west build -b` target, and Arduino FQBN validation.
// ---------------------------------------------------------------------------

import { KNOWN_MCUS, type KnownMcu, type KnownTarget } from './scaffold.js';
import { ZEPHYR_BOARD_SNAPSHOT, type ZephyrBoardEntry } from './zephyr-boards.generated.js';

/** An MCU catalog entry shaped for the create flow (KnownTarget-compatible:
 *  no boardPackage, mcu set, plus the silicon extras). */
export interface McuCreateTarget extends KnownTarget {
  isNative: false;
  boardPackage?: undefined;
  mcu: string;
  /** Zephyr SoC name(s) from the MCU package's silicon zephyr block. */
  zephyrSocs: string[];
  /** Datasheet port pin for the starter sketch. */
  sketchPin: string;
}

/** Look up an MCU catalog entry by id (e.g. 'stm32f411'). */
export function findKnownMcu(id: string): KnownMcu | undefined {
  return KNOWN_MCUS.find((m) => m.id === id);
}

/** Convert a catalog entry into the create-flow target shape. */
export function mcuAsTarget(mcu: KnownMcu): McuCreateTarget {
  return {
    id: mcu.id,
    displayName: mcu.displayName,
    isNative: false,
    architecture: mcu.architecture,
    mcu: mcu.mcu,
    zephyrSocs: mcu.zephyrSocs,
    sketchPin: mcu.sketchPin,
  };
}

/** True when the MCU package carries silicon Zephyr data (socs) — the
 *  precondition for both generated custom boards and the board snapshot. */
export function mcuSupportsZephyr(mcu: McuCreateTarget): boolean {
  return mcu.zephyrSocs.length > 0;
}

// ── Zephyr board snapshot ────────────────────────────────────────────────────

/**
 * CPU-cluster qualifier defaults for multi-variant SoCs — Zephyr rejects the
 * bare board name when a board ships multiple variants with no default, and
 * the application core / M33 cluster is the one firmware targets (mirrors the
 * qualified forms in framework-catalog's ZEPHYR_BOARD_IDS).
 */
const SOC_CLUSTER_QUALIFIER: Readonly<Record<string, string>> = {
  esp32: 'procpu',
  esp32s3: 'procpu',
  esp32c6: 'hpcore',
  rp2350a: 'm33',
  rp2350b: 'm33',
};

/** A snapshot board plus its default qualified `west build -b` target. */
export interface McuZephyrBoard {
  name: string;
  vendor: string;
  soc: string;
  /** Qualified target (e.g. 'blackpill_f411ce/stm32f411xe',
   *  'esp32s3_devkitc/esp32s3/procpu'). */
  target: string;
}

/** Every snapshot board whose SoC matches the MCU's silicon zephyr block. */
export function zephyrBoardsForMcu(mcu: McuCreateTarget): McuZephyrBoard[] {
  const results: McuZephyrBoard[] = [];
  for (const soc of mcu.zephyrSocs) {
    for (const entry of ZEPHYR_BOARD_SNAPSHOT[soc] ?? []) {
      results.push(zephyrBoardEntry(soc, entry));
    }
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

function zephyrBoardEntry(soc: string, entry: ZephyrBoardEntry): McuZephyrBoard {
  const cluster = SOC_CLUSTER_QUALIFIER[soc];
  return {
    name: entry.name,
    vendor: entry.vendor,
    soc,
    target: cluster ? `${entry.name}/${soc}/${cluster}` : `${entry.name}/${soc}`,
  };
}

/** Look one board up by its (bare) name — for the non-interactive
 *  `--zephyr-board <name>` flag. Undefined when the board is not in the
 *  snapshot under one of the MCU's SoCs. */
export function findZephyrBoardForMcu(
  mcu: McuCreateTarget,
  name: string,
): McuZephyrBoard | undefined {
  return zephyrBoardsForMcu(mcu).find((b) => b.name === name);
}

// ── Custom-board naming ──────────────────────────────────────────────────────

/**
 * Sanitize a raw name into a legal Zephyr board name — the same rules
 * framework-zephyr's generator applies (lowercase `[a-z0-9_]`), duplicated
 * here because create runs before the framework package is installed.
 */
export function sanitizeBoardName(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned : 'custom_board';
}

// ── Arduino FQBN ─────────────────────────────────────────────────────────────

/**
 * Validate the SHAPE of a pasted Arduino FQBN: `packager:architecture:board`
 * with an optional `:options` suffix. Full validation (core installed, board
 * exists) happens in the arduino toolchain's env check at first compile.
 */
export function isValidFqbn(fqbn: string): boolean {
  const parts = fqbn.trim().split(':');
  if (parts.length < 3 || parts.length > 4) return false;
  return parts.slice(0, 3).every((p) => p.length > 0);
}
