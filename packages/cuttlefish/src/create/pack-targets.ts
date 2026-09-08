// ---------------------------------------------------------------------------
// pack-targets.ts — any-board target resolution off the generated catalog.
//
// The curated KNOWN_TARGETS list covers the nine hardware-validated boards;
// the board data pack carries every Zephyr board variant (1,300+). This
// module turns a pack entry into the same KnownTarget shape the create flow
// consumes, so `typecad-hal create --target <any-zephyr-board>` works with no
// per-board catalog entry. The soc's prefix derives an architecture id for
// framework narrowing (the fallback maps unknowns to zephyr anyway).
// ---------------------------------------------------------------------------

import type { BoardDataEntry } from '../board-catalog/types.js';
import { activeBoardCatalog, findBoardInCatalog } from '../board-catalog/index.js';
import type { KnownTarget } from './scaffold.js';

/** A coarse architecture id derived from a Zephyr soc name. Used only for
 *  framework narrowing and display — every value here resolves through
 *  FALLBACK_FRAMEWORKS to zephyr, which is correct for every pack board;
 *  the known families just display nicely. */
const SOC_FAMILIES: [RegExp, string][] = [
  [/^esp32/, 'esp32'],
  [/^nrf5/, 'nrf52'],
  [/^nrf9/, 'nrf91'],
  [/^stm32/, 'stm32'],
  [/^stm32mp/, 'stm32mp1'],
  [/^rp2/, 'rp2040'],
  [/^samd/, 'samd'],
  [/^mcimx|^imx/, 'imx'],
];

export function architectureFromSoc(soc: string): string {
  for (const [re, family] of SOC_FAMILIES) {
    if (re.test(soc)) return family;
  }
  return soc;
}

/** Look up a pack entry by qualified identifier or bare board name.
 *  Bare names with multiple variants return the first (deterministic —
 *  the pack is keyed in directory-walk order). */
export function findPackBoard(idOrTarget: string): { identifier: string; name: string; vendor: string; soc: string; probeMethods?: BoardDataEntry['probeMethods'] } | undefined {
  const data = activeBoardCatalog();
  const raw = idOrTarget.trim();
  const entry = findBoardInCatalog(data, raw);
  if (entry) {
    return { identifier: entry.identifier, name: entry.name, vendor: entry.vendor, soc: entry.identifier.split('/')[1], probeMethods: entry.probeMethods };
  }
  return undefined;
}

/** Build a create-flow KnownTarget from a pack entry. */
export function packBoardAsTarget(entry: { identifier: string; name: string; soc: string }): KnownTarget {
  return {
    id: entry.identifier.split('/')[0],
    displayName: entry.name,
    isNative: false,
    architecture: architectureFromSoc(entry.soc) as KnownTarget['architecture'],
    board: entry.identifier,
    buildTarget: entry.identifier,
    soc: entry.soc,
  };
}
