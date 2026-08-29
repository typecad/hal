// ---------------------------------------------------------------------------
// MCU-only create-target resolution
//
// Shared logic for `cuttlefish create --mcu <id>` and the wizard's bare-MCU
// entries: framework narrowing (Zephyr needs the package's silicon zephyr
// block), the Zephyr board decision (generated custom board vs any upstream
// board whose SoC matches, from the exhaustive snapshot), and the default
// qualified `west build -b` target.
// ---------------------------------------------------------------------------

import { KNOWN_MCUS, type KnownMcu, type KnownTarget } from './scaffold.js';
import { BOARD_DATA } from './board-catalog.generated.js';

/** An MCU catalog entry shaped for the create flow (KnownTarget-compatible:
 *  no board target, soc set, plus the silicon extras). */
export interface McuCreateTarget extends KnownTarget {
  isNative: false;
  board?: undefined;
  /** Zephyr SoC name — the curated soc descriptor key. */
  soc: string;
  /** Datasheet port pin for the starter program. */
  starterPin: string;
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
    soc: mcu.soc,
    starterPin: mcu.starterPin,
  };
}

/** True when the MCU package carries silicon Zephyr data (socs) — the
 *  precondition for both generated custom boards and the board snapshot. */
export function mcuSupportsZephyr(mcu: McuCreateTarget): boolean {
  return true;
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

/** Every catalog board variant whose SoC matches the bare-silicon soc. */
export function zephyrBoardsForMcu(mcu: McuCreateTarget): McuZephyrBoard[] {
  const results: McuZephyrBoard[] = [];
  for (const [identifier, entry] of Object.entries(BOARD_DATA)) {
    const soc = identifier.split('/')[1];
    if (soc !== mcu.soc) continue;
    results.push({
      name: entry.name,
      vendor: entry.vendor,
      soc,
      target: identifier,
    });
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
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
