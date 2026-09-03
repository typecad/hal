// ---------------------------------------------------------------------------
// board-search.ts — the create-wizard target picker: one filterable select.
//
// Everything the wizard can target rides a single searchable list:
//   - Native Desktop (the one non-embedded target)
//   - Bare silicon (soc entries — contract/custom-PCB projects)
//   - Every Zephyr board variant from the generated catalog (1,300+;
//     the curated nine sit wherever their names sort — no badge, the
//     picker is a flat search surface)
//
// Typing "esp32" narrows to the espressif variants; typing "nrf52" to the
// Nordic ones; arrows + enter pick. Uses inquirer-select-pro's filter mode.
// ---------------------------------------------------------------------------

import { select } from 'inquirer-select-pro';
import { activeBoardCatalog } from '../board-catalog/index.js';
import { KNOWN_TARGETS } from './scaffold.js';

/** The discriminator union the wizard switches on. */
export type TargetPick =
  | { kind: 'native' }
  | { kind: 'mcu'; id: string }
  | { kind: 'board'; entry: { identifier: string; name: string; soc: string } };

/** Flat option list: native first, then bare silicon, then every board
 *  variant (alphabetical by the pack's directory-walk order). */
function targetOptions(): Array<{ name: string; value: string }> {
  const native = KNOWN_TARGETS
    .filter((t) => t.isNative)
    .map((t) => ({ name: `${t.displayName} (Windows/Linux executable)`, value: `native:${t.id}` }));

  const boards = Object.values(activeBoardCatalog()).map((b) => ({
    name: `${b.name} (${b.identifier})`,
    value: b.identifier,
  }));

  return [...native, ...boards];
}

/** Resolve a picked value back to its discriminated form. */
function resolvePick(value: string): TargetPick | undefined {
  if (value.startsWith('native:')) return { kind: 'native' };
  // Board: value IS the qualified identifier.
  const entry = activeBoardCatalog()[value];
  if (!entry) return undefined;
  return { kind: 'board', entry: { identifier: entry.identifier, name: entry.name, soc: value.split('/')[1] } };
}

/**
 * Build a filterable options loader for `inquirer-select-pro`. The select
 * only enables its filter input when `options` is a *function* (a static
 * array disables filtering entirely), so we wrap the flat list in a
 * case-insensitive substring matcher.
 */
function filterableTargetOptions() {
  const all = targetOptions();
  return (input?: string) => {
    const query = (input ?? '').trim().toLowerCase();
    if (!query) return all;
    return all.filter((o) => o.name.toLowerCase().includes(query));
  };
}

export async function pickTarget(): Promise<TargetPick | undefined> {
  const value = await select<string, false>({
    message: 'Target (type to filter — e.g. "esp32", "nucleo", "native"):',
    multiple: false,
    options: filterableTargetOptions(),
    filter: true,
    pageSize: 15,
  });

  if (value === undefined || value === null) return undefined;
  return resolvePick(value as string);
}

/** Back-compat alias for the board-only picker (still used by tests/tools
 *  that want boards only). */
export async function pickBoard(): Promise<{ identifier: string; name: string; soc: string; curated: boolean } | undefined> {
  const boards = Object.values(activeBoardCatalog()).map((b) => ({ name: `${b.name} (${b.identifier})`, value: b.identifier }));
  const value = await select<string, false>({
    message: 'Board (type to filter — e.g. "esp32", "nucleo_f411"):',
    multiple: false,
    options: (input?: string) => {
      const query = (input ?? '').trim().toLowerCase();
      if (!query) return boards;
      return boards.filter((b) => b.name.toLowerCase().includes(query));
    },
    filter: true,
    pageSize: 15,
  });
  if (value === undefined || value === null) return undefined;
  const entry = activeBoardCatalog()[value as string];
  if (!entry) return undefined;
  return { identifier: entry.identifier, name: entry.name, soc: (value as string).split('/')[1], curated: false };
}
