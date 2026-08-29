#!/usr/bin/env node
// ---------------------------------------------------------------------------
// hal/run.mjs — `npm run hal` entry: run the hardware HAL suites on every
// CONNECTED board, skipping (not failing) the ones that aren't.
//
// Each subdirectory is a self-contained expect project (cuttlefish.config.ts
// + hal.test.ts) whose test.usb block names the board's CDC identity. This
// runner lists the USB serial ports once, matches each project's identity,
// and invokes cuttlefish-test in the project dir for the matches. A board
// that isn't connected prints one skip line; a connected board that FAILS
// fails the whole run.
//
// The port listing reuses @typecad/expect's port-discovery (imported by file
// path so its 'serialport' dependency resolves from the expect package's own
// node_modules).
// ---------------------------------------------------------------------------

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

// The board rig: one entry per expect project. vid/pid are the board
// package's declared usb block — the same identity test.usb matches on.
const BOARDS = [
  { dir: 'blackpill', name: 'STM32 Black Pill F411CE', vid: '2fe3', pid: '0002' },
  { dir: 'nano33iot', name: 'Arduino Nano 33 IoT (SAMD21)', vid: '2fe3', pid: '0003' },
  { dir: 'esp32s3', name: 'ESP32-S3 devkitC', vid: '1a86', pid: '55d3' },
];

async function listPorts() {
  const modPath = path.join(repoRoot, 'packages', 'expect', 'dist', 'host', 'port-discovery.js');
  const mod = await import(pathToFileURL(modPath).href);
  return mod.listUsbSerialPorts();
}

// --board <dir> restricts the run to one project (the board packages'
// `npm run hal` scripts use this): node run.mjs --board esp32s3
const onlyArg = process.argv.indexOf('--board');
const only = onlyArg !== -1 ? process.argv[onlyArg + 1] : undefined;

const ports = await listPorts();
const results = [];

for (const b of only ? BOARDS.filter((x) => x.dir === only) : BOARDS) {
  if (only && BOARDS.every((x) => x.dir !== only)) {
    console.log(`– unknown --board '${only}'. Known: ${BOARDS.map((x) => x.dir).join(', ')}`);
    process.exit(1);
  }
  const dir = path.join(here, b.dir);
  if (!fs.existsSync(path.join(dir, 'cuttlefish.config.ts'))) {
    console.log(`– ${b.name}: no project in hal/${b.dir}, skipped`);
    continue;
  }
  const match = ports.find((p) => p.vid === b.vid && p.pid === b.pid);
  if (!match) {
    console.log(`– ${b.name}: not connected, skipped`);
    results.push({ name: b.name, status: 'skipped' });
    continue;
  }
  console.log(`\n=== ${b.name} @ ${match.path} ===\n`);
  const bin = path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'cuttlefish-test.cmd' : 'cuttlefish-test');
  // The CLI resolves its project root through INIT_CWD when the env carries
  // it (npm exec semantics). When this runner is itself launched via
  // `npm run hal`, the inherited INIT_CWD points at the BOARD PACKAGE dir,
  // not the suite dir — repin it to the cwd we deliberately set below.
  const res = spawnSync(bin, ['--verbose'], {
    cwd: dir,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, INIT_CWD: dir },
  });
  results.push({ name: b.name, status: res.status === 0 ? 'passed' : 'failed' });
}

console.log('\n=== HAL hardware run summary ===');
for (const r of results) {
  const mark = r.status === 'passed' ? '✓' : r.status === 'skipped' ? '–' : '✗';
  console.log(` ${mark} ${r.name}: ${r.status}`);
}
process.exit(results.some((r) => r.status === 'failed') ? 1 : 0);
