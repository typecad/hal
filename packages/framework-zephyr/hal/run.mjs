#!/usr/bin/env node
// ---------------------------------------------------------------------------
// hal/run.mjs — `npm run hal` entry: run the hardware HAL suites on every
// CONNECTED board, skipping (not failing) the ones that aren't.
//
// Each subdirectory is a self-contained expect project (typecad-hal.config.ts
// + hal.test.ts) whose test.usb block names the board's CDC identity. This
// runner lists the USB serial ports once, matches each project's identity,
// and invokes typecad-hal test in the project dir for the matches. A board
// that isn't connected prints one skip line; a connected board that FAILS
// fails the whole run.
//
// CDC identities: per-board PID assignment is gone — every Zephyr CDC board
// enumerates at the Zephyr-test default 2fe3:0001 — so all CDC projects
// share one identity and the rig assumes only ONE CDC board is connected at
// a time (the same port would satisfy every CDC project's match). Bridge
// boards (CH340/16U2/CP2102) still identify by their real bridge vid/pid.
//
// The port listing reuses the engine test-runner's port-discovery (imported
// by file path so its 'serialport' dependency resolves from the typecad-hal
// package's own node_modules — an optionalDependency there).
// ---------------------------------------------------------------------------

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

// The board rig: one entry per expect project. vid/pid are what the flashed
// firmware enumerates as — the Zephyr-test default (2fe3:0001) for CDC
// boards, the real bridge chip identity for UART-bridge boards.
const BOARDS = [
  { dir: 'blackpill', name: 'STM32 Black Pill F411CE', vid: '2fe3', pid: '0001' },
  { dir: 'nano33iot', name: 'Arduino Nano 33 IoT (SAMD21)', vid: '2fe3', pid: '0001' },
  { dir: 'esp32s3', name: 'ESP32-S3 devkitC', vid: '1a86', pid: '55d3' },
];

async function listPorts() {
  const modPath = path.join(repoRoot, 'packages', 'typecad-hal', 'dist', 'test-runner', 'port-discovery.js');
  const mod = await import(pathToFileURL(modPath).href);
  return mod.listUsbSerialPorts();
}

// --board <dir> restricts the run to one project (the board packages'
// `npm run hal` scripts use this): node run.mjs --board esp32s3
const onlyArg = process.argv.indexOf('--board');
const only = onlyArg !== -1 ? process.argv[onlyArg + 1] : undefined;

const ports = await listPorts();
const results = [];

// All Zephyr CDC boards share the default identity (2fe3:0001), so with one
// CDC board attached EVERY CDC project's identity matches its port. The first
// CDC project that PASSES on a port claims it; a later CDC project failing on
// the same port is the shared-identity ambiguity (it ran against the wrong
// board — e.g. the bossac touch found no bootloader), not a real failure:
// report it as skipped. Run a specific board with --board to be explicit.
let claimedCdcPort;

for (const b of only ? BOARDS.filter((x) => x.dir === only) : BOARDS) {
  if (only && BOARDS.every((x) => x.dir !== only)) {
    console.log(`– unknown --board '${only}'. Known: ${BOARDS.map((x) => x.dir).join(', ')}`);
    process.exit(1);
  }
  const dir = path.join(here, b.dir);
  if (!fs.existsSync(path.join(dir, 'typecad-hal.config.ts'))) {
    console.log(`– ${b.name}: no project in hal/${b.dir}, skipped`);
    continue;
  }
  const match = ports.find((p) => p.vid === b.vid && p.pid === b.pid);
  if (!match) {
    console.log(`– ${b.name}: not connected, skipped`);
    results.push({ name: b.name, status: 'skipped' });
    continue;
  }
  const sharedCdc = b.vid === '2fe3' && b.pid === '0001';
  if (sharedCdc && claimedCdcPort && claimedCdcPort.path === match.path) {
    console.log(`– ${b.name}: shared CDC identity 2fe3:0001 already claimed by ${claimedCdcPort.name} @ ${match.path}, skipped`);
    results.push({ name: b.name, status: 'skipped' });
    continue;
  }
  console.log(`\n=== ${b.name} @ ${match.path} ===\n`);
  const bin = path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'typecad-hal test.cmd' : 'typecad-hal test');
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
  const passed = res.status === 0;
  if (passed && sharedCdc) {
    claimedCdcPort = { path: match.path, name: b.name };
  }
  results.push({ name: b.name, status: passed ? 'passed' : 'failed' });
}

console.log('\n=== HAL hardware run summary ===');
for (const r of results) {
  const mark = r.status === 'passed' ? '✓' : r.status === 'skipped' ? '–' : '✗';
  console.log(` ${mark} ${r.name}: ${r.status}`);
}
process.exit(results.some((r) => r.status === 'failed') ? 1 : 0);
