// ---------------------------------------------------------------------------
// 1200-baud touch-to-reset for BOSSA-bootloader boards (host side)
//
// The device side lives in the emitted USB shim (lowering/usb.ts): when the
// host sets the CDC baud rate to 1200, the firmware writes the bootloader's
// stay-resident magic to RAM and reboots — the board lands in the BOSSA
// bootloader without a button press. This module is the other half: open the
// app's console port at 1200 baud to trigger that reboot, then wait for the
// bootloader's own USB identity to appear and report its port so bossac can
// be pointed at it.
//
// Runs as a spawned `node -e` helper (upload() is synchronous; serialport's
// open/poll loop is async) with require() resolution rooted at THIS package,
// so `serialport` resolves from the monorepo's hoisted node_modules. In a
// published install without serialport available, the touch is skipped with
// a note telling the user to double-tap reset — never a hard failure.
// ---------------------------------------------------------------------------

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The descriptor subset this helper needs (see ZephyrChipDescriptor.usb.touchReset). */
export interface TouchResetInfo {
  readonly flagAddress: number;
  readonly magic: number;
  readonly bootloaderVid?: string;
  readonly bootloaderPid?: string;
}

export interface TouchResetResult {
  /** Bootloader port to flash (undefined = touch failed / timed out). */
  readonly port?: string;
  /** Human-readable outcome for the build log. */
  readonly note: string;
}

// CommonJS so `node -e` can require() it without a package "type" lookup.
// Keep the logic compact: open at 1200, close, poll for the bootloader
// identity, print the port (or nothing) on stdout.
const TOUCH_SCRIPT = `
const SerialPort = require('serialport');
const [appPort, wantVid, wantPid, timeoutMsStr] = process.argv.slice(1);
const norm = (v) => (v || '').toLowerCase().replace(/^0x/, '');
const timeoutMs = parseInt(timeoutMsStr, 10) || 15000;
function die(msg) { console.log(JSON.stringify({ error: msg })); process.exit(0); }
// The open call itself delivers the touch: serialport applies the 1200-baud
// line coding as part of opening, and the firmware resets to the bootloader
// MID-OPEN — so the open erroring ("File not found" on Windows as the device
// vanishes) is the EXPECTED symptom of success, not a failure. Whatever the
// open result, proceed to watching for the bootloader identity; only a
// missing bootloader after the timeout is a real failure.
async function watchForBootloader() {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    try {
      const list = await SerialPort.SerialPort.list();
      const hit = list.find((p) =>
        norm(p.vendorId) === norm(wantVid) && norm(p.productId) === norm(wantPid));
      if (hit) { console.log(JSON.stringify({ port: hit.path })); process.exit(0); }
    } catch { /* transient enumeration races while ports bounce */ }
  }
  die('timeout');
}
const port = new SerialPort.SerialPort({ path: appPort, baudRate: 1200, autoOpen: false });
port.open((err) => {
  if (err) { watchForBootloader(); return; }
  // The 1200-baud line coding was applied BY the open; close immediately —
  // the firmware's 250 ms pre-reboot delay covers the ordering, and holding
  // the handle open across the device reset is what wedges usbser.
  port.close(() => watchForBootloader());
});
`;

/**
 * Touch the app port at 1200 baud and wait for the bootloader to appear.
 * Never throws — a failed touch degrades to "double-tap reset" guidance.
 */
export function bossacTouchReset(
  appPort: string,
  info: TouchResetInfo,
  timeoutMs = 30_000,
): TouchResetResult {
  if (!info.bootloaderVid || !info.bootloaderPid) {
    return { note: 'touch-reset: board declares no bootloader USB identity — skipping (double-tap reset to enter the bootloader)' };
  }
  const pkgDir = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // .../src -> package root
  let result: ReturnType<typeof spawnSync>;
  try {
    result = spawnSync(
      process.execPath,
      ['-e', TOUCH_SCRIPT, '--', appPort, info.bootloaderVid, info.bootloaderPid, String(timeoutMs)],
      { encoding: 'utf8', timeout: timeoutMs + 10_000, cwd: pkgDir },
    );
  } catch {
    return { note: 'touch-reset: helper failed to launch — double-tap reset to enter the bootloader' };
  }
  const stdout = (typeof result.stdout === 'string' ? result.stdout : '').trim();
  const lastLine = stdout.split('\n').filter(Boolean).pop() ?? '';
  try {
    const parsed = JSON.parse(lastLine) as { port?: string; error?: string };
    if (parsed.port) {
      return { port: parsed.port, note: `touch-reset: bootloader on ${parsed.port}` };
    }
    return { note: 'touch-reset: bootloader did not re-appear in time — double-tap reset and retry' };
  } catch {
    // serialport not resolvable (published install without it) or the helper
    // crashed — degrade gracefully.
    return { note: 'touch-reset: unavailable (serialport not installed?) — double-tap reset to enter the bootloader' };
  }
}
