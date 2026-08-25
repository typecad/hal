#!/usr/bin/env node
// ---------------------------------------------------------------------------
// gen-zephyr-boards.mjs — regenerate the exhaustive Zephyr board snapshot
//
// Enumerates every board in a Zephyr workspace via scripts/list_boards.py
// and writes packages/cuttlefish/src/create/zephyr-boards.generated.ts,
// grouped by SoC. The snapshot backs `cuttlefish create`'s MCU-only flow:
// pick an MCU → pick any Zephyr board whose SoC matches the MCU package's
// zephyr.socs, with no typecad board package required.
//
// The Zephyr revision is pinned (packages/zephyr-installer/versions.env,
// ZEPHYR_MANIFEST_REV), so the checked-in snapshot is stable between pins —
// regenerate as part of the version-bump checklist, against a workspace
// checked out at the pinned revision:
//
//   node scripts/gen-zephyr-boards.mjs <path-to-zephyr-workspace>
//
// (no argument → ~/zephyrproject)
// ---------------------------------------------------------------------------

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const workspace = process.argv[2] ?? join(homedir(), 'zephyrproject');
const zephyrBase = join(workspace, 'zephyr');
if (!existsSync(join(zephyrBase, 'scripts', 'list_boards.py'))) {
  console.error(`No Zephyr checkout at ${zephyrBase} — pass a west workspace path.`);
  process.exit(1);
}

const version = readFileSync(join(zephyrBase, 'VERSION'), 'utf8')
  .split('\n')
  .filter((l) => l.startsWith('VERSION_MAJOR') || l.startsWith('VERSION_MINOR'))
  .map((l) => l.split('=')[1].trim())
  .join('.');
const pinLine = readFileSync(new URL('../packages/zephyr-installer/versions.env', import.meta.url), 'utf8')
  .match(/^ZEPHYR_MANIFEST_REV=(.+)$/m)?.[1]?.trim();

// One line per board: NAME=name;board VENDOR=vendor;weact SOCS=socs;a;b
const out = execFileSync('python', [
  join(zephyrBase, 'scripts', 'list_boards.py'),
  `--board-root=${zephyrBase}`,
  `--soc-root=${zephyrBase}`,
  '--cmakeformat', 'NAME={NAME} VENDOR={VENDOR} SOCS={SOCS}',
], { encoding: 'utf8' });

/** @type {Record<string, {name: string, vendor: string, socs: string[]}[]>} grouped by first SoC */
const bySoc = {};
let count = 0;
for (const line of out.split('\n')) {
  const name = line.match(/NAME=NAME;(\S+)/)?.[1];
  const vendor = line.match(/VENDOR=VENDOR;(\S+)/)?.[1] ?? 'unknown';
  const socs = (line.match(/SOCS=SOCS;(\S+)/)?.[1] ?? '').split(';').filter(Boolean);
  if (!name || socs.length === 0) continue;
  count += 1;
  (bySoc[socs[0]] ??= []).push({ name, vendor, socs });
}
for (const boards of Object.values(bySoc)) {
  boards.sort((a, b) => a.name.localeCompare(b.name));
}

const header = `// ---------------------------------------------------------------------------
// zephyr-boards.generated.ts — the exhaustive Zephyr board snapshot
//
// GENERATED FILE — do not edit by hand. Regenerate against a workspace at the
// pinned revision (${pinLine ?? 'see versions.env'}) with:
//
//   node scripts/gen-zephyr-boards.mjs <workspace>
//
// Enumerated from Zephyr ${version} via scripts/list_boards.py: every HWMv2
// board, grouped by SoC (the join key for MCU-only targets — an MCU package's
// zephyr.socs selects the compatible boards). ${count} boards across
// ${Object.keys(bySoc).length} SoCs.
// ---------------------------------------------------------------------------

/** One Zephyr board: its \`west build -b\` name, vendor folder, and SoC(s). */
export interface ZephyrBoardEntry {
  name: string;
  vendor: string;
  socs: string[];
}

/** Boards grouped by first SoC name (e.g. 'stm32f411xe' → WeAct blackpill, …). */
export const ZEPHYR_BOARD_SNAPSHOT: Readonly<Record<string, ZephyrBoardEntry[]>> = {
`;

const body = Object.keys(bySoc).sort().map((soc) => {
  const entries = bySoc[soc].map((b) => `    { name: '${b.name}', vendor: '${b.vendor}', socs: [${b.socs.map((s) => `'${s}'`).join(', ')}] },`);
  return `  '${soc}': [\n${entries.join('\n')}\n  ],`;
}).join('\n');

writeFileSync(new URL('../packages/cuttlefish/src/create/zephyr-boards.generated.ts', import.meta.url), `${header}${body}\n};\n`, 'utf8');
console.log(`Wrote ${count} boards across ${Object.keys(bySoc).length} SoCs (Zephyr ${version}).`);
