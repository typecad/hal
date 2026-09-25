// ---------------------------------------------------------------------------
// board-search.ts — the create-wizard target picker: one filterable select.
//
// Everything the wizard can target rides a single searchable list:
//   - Native Desktop (the one non-embedded target)
//   - Every Zephyr board variant from the generated catalog (1,300+; the
//     curated nine sit wherever their names sort — no badge, the picker is a
//     flat search surface)
//
// Typing "esp32" narrows to the espressif variants; typing "nrf52" to the
// Nordic ones; arrows + enter pick. Uses inquirer-select-pro's filter mode.
//
// When stdin is NOT a terminal (the wizard spawned by a parent tool — e.g.
// the pcb CLI's `typecad-pcb create` — with a piped stdin), the raw-mode
// keypress select cannot be driven reliably: it needs byte-by-byte input the
// parent may never forward. The picker then degrades to a line-based search
// (query → numbered matches → pick-or-refine) that works over any stdin the
// parent forwards line by line, and fails fast with an actionable message
// when stdin is dead (never forwarded / ignored).
// ---------------------------------------------------------------------------

import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import chalk from "chalk";
import { select } from 'inquirer-select-pro';
import { activeBoardCatalog } from '../board-catalog/index.js';
import { KNOWN_TARGETS } from './scaffold.js';
import { ask, StdinClosedError, printNonInteractiveCancel } from './prompt-io.js';

/** The discriminator union the wizard switches on. */
export type TargetPick =
  | { kind: 'native' }
  | { kind: 'mcu'; id: string }
  | { kind: 'board'; entry: { identifier: string; name: string; soc: string } };

/** Flat option list: native first, then every board variant (alphabetical by
 *  the pack's directory-walk order). */
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

function filterMatches(
  all: Array<{ name: string; value: string }>,
  query: string,
): Array<{ name: string; value: string }> {
  const q = query.trim().toLowerCase();
  if (!q) return all;
  return all.filter((o) => o.name.toLowerCase().includes(q));
}

const PAGE_SIZE = 15;

/**
 * Line-based fallback picker for non-TTY stdin: query → numbered matches →
 * pick-or-refine, one readline question per step. No raw mode, no keypress
 * events — every step terminates with Enter, so it works over any stdin a
 * parent tool forwards. `asker`/`log` are injectable for tests.
 */
export async function lineModePick(
  what: string,
  all: Array<{ name: string; value: string }>,
  asker: (prompt: string) => Promise<string>,
  log: (line: string) => void = console.log,
): Promise<string | undefined> {
  try {
    let query: string | null = null; // null = ask for a fresh query first
    while (true) {
      if (query === null) {
        const searched = await asker(`  ${chalk.cyan("?")} Search ${what} (empty lists the first ${PAGE_SIZE}): `);
        query = searched.trim().toLowerCase();
      }
      const matches = filterMatches(all, query);
      if (matches.length === 0) {
        log(`  ${chalk.yellow("!")} No ${what} matches "${query.trim()}" — try another search.`);
        query = null;
        continue;
      }
      const shown = matches.slice(0, PAGE_SIZE);
      shown.forEach((o, i) => log(`  ${chalk.dim(`${i + 1})`)} ${o.name}`));
      if (matches.length > shown.length) {
        log(`  ${chalk.dim(`…and ${matches.length - shown.length} more — search to narrow`)}`);
      }
      const picked = await asker(`  ${chalk.cyan("?")} Pick 1-${shown.length}, or type a new search: `);
      const t = picked.trim();
      if (/^\d+$/.test(t)) {
        const idx = parseInt(t, 10) - 1;
        if (idx >= 0 && idx < shown.length) {
          return shown[idx]!.value;
        }
        log(`  ${chalk.red("✗")} Enter a number between 1 and ${shown.length}.`);
        continue; // re-list the same query
      }
      query = t.toLowerCase(); // a non-number is a new search term
    }
  } catch (err) {
    if (err instanceof StdinClosedError) {
      printNonInteractiveCancel();
      return undefined;
    }
    throw err;
  }
}

/**
 * Pick a value from the flat list: the raw-mode filterable select on a real
 * terminal, the line-based search when stdin is a pipe (spawned wizard).
 */
async function pickValueInteractively(
  what: string,
  message: string,
  all: Array<{ name: string; value: string }>,
): Promise<string | undefined> {
  if (stdin.isTTY) {
    const picked = await select<string, false>({
      message,
      multiple: false,
      // The select only enables its filter input when `options` is a
      // *function* (a static array disables filtering entirely).
      options: (input?: string) => filterMatches(all, input ?? ''),
      filter: true,
      pageSize: PAGE_SIZE,
    });
    return picked ?? undefined;
  }
  console.log(`  ${chalk.dim(`(stdin is not a terminal — line-based ${what} search: type a query, then a number)`)}`);
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    return await lineModePick(what, all, (prompt) => ask(rl, prompt));
  } finally {
    try { rl.close(); } catch { /* already closed */ }
  }
}

export async function pickTarget(): Promise<TargetPick | undefined> {
  const value = await pickValueInteractively(
    'target',
    'Target (type to filter — e.g. "esp32", "nucleo", "native"):',
    targetOptions(),
  );

  if (value === undefined || value === null) return undefined;
  return resolvePick(value as string);
}

/** Back-compat alias for the board-only picker (still used by tests/tools
 *  that want boards only). */
export async function pickBoard(): Promise<{ identifier: string; name: string; soc: string; curated: boolean } | undefined> {
  const boards = Object.values(activeBoardCatalog()).map((b) => ({ name: `${b.name} (${b.identifier})`, value: b.identifier }));
  const value = await pickValueInteractively(
    'board',
    'Board (type to filter — e.g. "esp32", "nucleo_f411"):',
    boards,
  );
  if (value === undefined || value === null) return undefined;
  const entry = activeBoardCatalog()[value as string];
  if (!entry) return undefined;
  return { identifier: entry.identifier, name: entry.name, soc: (value as string).split('/')[1], curated: false };
}
