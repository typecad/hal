#!/usr/bin/env node
// Two-terminal BLE hardware suite orchestrator (deterministic pipeline).
//
// The in-harness serial reader proved flaky on the CH34x-bridged S3 (DTR
// races reset the board mid-suite), so this drives a fixed pipeline instead:
//
//   1. typecad-hal test --dry-run  → transpiles + west-builds the expect
//      firmware into .build/expect/ble_peripheral/out (no upload, no read)
//   2. west flash (esp32 runner)  → flashes it over the CH34x bridge
//   3. serial-watch               → DTR reset pulse + raw console capture
//      (all [TC:...] protocol lines land in the watch log)
//   4. ble-client.ts (noble)      → host central connects + exercises GATT
//   5. verdict                    → parse the watch log's [TC:EXPECT] lines
//      (expected==actual for every assert) + the central's checks summary
//
//   node ble-orchestrate.mjs            (or: npm run test:hw:ble:full)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const MAX = 3;
const P_OUT = path.join(here, '.build', 'expect', 'ble_peripheral', 'out');
const P_LOG = path.join(repoRoot, 'tmp-ble-watch.log');
const C_LOG = path.join(repoRoot, 'tmp-ble-central.log');
const ENV = {
  ...process.env,
  ZEPHYR_BASE: 'C:\\Users\\justi\\zephyrproject\\zephyr',
  PATH: `C:\\Users\\justi\\micromamba\\envs\\zephyr;C:\\Users\\justi\\micromamba\\envs\\zephyr\\Library\\bin;C:\\Users\\justi\\micromamba\\envs\\zephyr\\Scripts;${process.env.PATH ?? ''}`,
};

const sh = (cmd, args, cwd, log, env = process.env) => new Promise((resolve) => {
  const out = fs.openSync(log, 'w');
  const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', out, out] });
  const t = setTimeout(() => { child.kill(); resolve(1); }, 600_000);
  child.on('exit', (code) => { clearTimeout(t); resolve(code ?? 1); });
  child.on('error', () => { clearTimeout(t); resolve(1); });
});

function parseProtocol(text) {
  const expects = [...text.matchAll(/\[TC:EXPECT:[^:]+:([^:]*):([^\]]*)\]/g)];
  const pass = expects.filter((m) => m[1] === m[2]);
  return { total: expects.length, passed: pass.length, failed: expects.length - pass.length };
}

for (let attempt = 1; attempt <= MAX; attempt++) {
  console.log(`\n=== BLE cycle ${attempt}/${MAX} ===`);

  // 1. Build the expect firmware (transpile + west build, no upload).
  const build = await sh(
    process.execPath,
    [path.join(repoRoot, 'packages', 'expect', 'dist', 'host', 'cli.js'),
     '--config', 'ble-demo.config.ts', '--dry-run', 'ble-peripheral.test.ts'],
    here, path.join(repoRoot, 'tmp-ble-build.log'),
  );
  if (build !== 0) { console.log('build FAILED'); continue; }

  // 2. Flash it directly (esp32 runner over the bridge).
  const flash = await sh(
    'west', ['flash', '--build-dir', 'build', '--runner', 'esp32', '--esp-device', 'COM9'],
    P_OUT, path.join(repoRoot, 'tmp-ble-flash.log'), ENV,
  );
  if (flash !== 0) { console.log('flash FAILED'); continue; }

  // 3+4. Watcher on COM9 (reset pulse + capture) and, 13 s in, the central.
  const watch = spawn(process.execPath,
    [path.join(here, 'serial-watch.mjs'), '115'],
    { cwd: here, detached: false, stdio: ['ignore', fs.openSync(P_LOG, 'w'), fs.openSync(P_LOG, 'a')] });
  await new Promise((r) => setTimeout(r, 13_000));
  const central = await sh(
    process.execPath,
    [path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(here, 'ble-client.ts')],
    repoRoot, C_LOG,
  );
  await new Promise((r) => watch.on('exit', r));

  // 5. Verdict from the captured protocol lines + the central's summary.
  const proto = parseProtocol(fs.readFileSync(P_LOG, 'utf8'));
  const cText = fs.readFileSync(C_LOG, 'utf8');
  const centralOk = central === 0 && cText.includes('12 passed');
  const periphOk = proto.total >= 7 && proto.failed === 0;
  console.log(`peripheral: ${proto.passed}/${proto.total} asserts ${periphOk ? 'PASS' : 'FAIL'}   central: ${centralOk ? '12/12 PASS' : 'FAIL'}`);
  if (periphOk && centralOk) { console.log('\n=== BLE suite GREEN ==='); process.exit(0); }
}
console.log('\n=== BLE suite did not go green within retries ===');
process.exit(1);
