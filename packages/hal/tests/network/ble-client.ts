// Host GATT central for the on-hardware BLE suite.
//
// The inverse of start-server.ts (this directory): there the host runs a server
// the firmware (HTTP client) hits; here the host is the GATT central and the
// firmware (demos/ble-demo/src/08-test-server.ts) is the peripheral. This
// script cannot be transpiled into firmware — @abandonware/noble is a native
// Node BLE stack — so it runs in plain Node like start-server.ts.
//
// Two-terminal flow (mirrors test:http / test:hw:http):
//   Terminal 1 (peripheral):  npm run test:hw:ble -- --port COM10
//                             ↑ flashes + runs ble-peripheral.test.ts, which
//                               advertises "CuttlefishTest" and waits.
//   Terminal 2 (central):     npm run test:ble
//                             ↑ this file — connects, exercises GATT, prints
//                               a TAP-style pass/fail summary, exits.
//
// The advertised device name is the deterministic handshake (not a MAC): the
// central scans for "CuttlefishTest", so the suite is stable across re-flashes
// and independent of whatever else is advertising in the room.
//
// ── Windows prerequisite (read before first run) ──────────────────────────
// @abandonware/bluetooth-hci-socket talks the HCI transport over WinUSB, not
// the Microsoft Bluetooth stack. You must replace your adapter's driver ONCE
// with WinUSB via Zadig (https://zadig.akeo.ie). This disables normal Windows
// Bluetooth for that adapter until you revert it with the manufacturer driver.
// Use a dedicated test adapter, or revert via Device Manager → "Update Driver"
// → pick the Qualcomm/Intel/Realtek driver when done. Full steps + the VC++
// redist prerequisite are in README.md (this directory).

import noble from '@abandonware/noble';

// ── Constants — must match demos/ble-demo/src/08-test-server.ts ───────────
const DEVICE_NAME = 'CuttlefishTest';

// 16-bit SIG characteristic UUIDs (noble lowercases them; compare normalized).
const TEMP_UUID = '2a6e';        // int16 LE, 0.01 °C/LSB
const SETPOINT_UUID = '2a1f';    // int16 LE, read+write
const NOTIFY_UUID = '2a58';      // int16 LE, read+notify
const HUMIDITY_UUID = '2a6f';    // uint16 LE, 0.01 %/LSB
const BATTERY_UUID = '2a19';     // uint8, %
// Vendor 128-bit UUIDs.
const CUSTOM_UINT8_UUID = 'a1b2c3d400101000800000805f9b34fb';
const CUSTOM_UTF8_UUID = 'a1b2c3d400111000800000805f9b34fb';

// Expected values — duplicated from 08-test-server.ts.
const EXPECT_TEMP = 2180;
const EXPECT_HUMIDITY = 5500;
const EXPECT_BATTERY = 87;
const EXPECT_CUSTOM_UINT8 = 42;
const EXPECT_CUSTOM_UTF8 = 'typecad-hal-ble';
const EXPECT_SETPOINT_DEFAULT = 2000;
const WRITE_SETPOINT = 2350;     // host writes this, then reads it back
const EXPECT_NOTIFY_FIRST = 2200; // first value the peripheral pushes

// Timeouts. BLE discovery + GATT traversal is slow; give each phase headroom.
const SCAN_TIMEOUT_MS = 300_000;   // covers the peripheral's full build+flash+boot
const CONNECT_TIMEOUT_MS = 15_000;
const GATT_TIMEOUT_MS = 15_000;
const NOTIFY_TIMEOUT_MS = 15_000;

/** A single check result printed in the summary. */
interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

const checks: Check[] = [];

function record(name: string, pass: boolean, detail: string): void {
  checks.push({ name, pass, detail });
  // Stream live so the operator sees progress (BLE runs long).
  const tag = pass ? 'PASS' : 'FAIL';
  console.log(`  ${pass ? '✓' : '✗'} ${name} — ${tag}${detail ? ': ' + detail : ''}`);
}

function fail(msg: string): never {
  console.error(`\n  ERROR: ${msg}`);
  console.error('  See README.md (this directory) (BLE section) for setup steps.\n');
  process.exit(1);
}

/** Reject after ms — guards every async phase so a hung adapter can't stall CI. */
function timeout(ms: number, label: string): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms),
  );
}

const norm = (uuid: string): string => uuid.replace(/[^0-9a-f]/gi, '').toLowerCase();

/** Read a little-endian signed int16. */
function readInt16LE(buf: Buffer): number {
  return buf.readInt16LE(0);
}
/** Read a little-endian unsigned int16. */
function readUInt16LE(buf: Buffer): number {
  return buf.readUInt16LE(0);
}

/** Discover services+characteristics and index them by normalized UUID.
 *  Windows noble occasionally wedges mid-discovery ("device not connected"
 *  while the link is up) — one retry recovers it more often than not. */
async function loadCharacteristics(peripheral: noble.Peripheral): Promise<Map<string, noble.Characteristic>> {
  let characteristics: noble.Characteristic[] | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      ({ characteristics } = await peripheral.discoverAllServicesAndCharacteristicsAsync());
      break;
    } catch (e) {
      if (attempt === 2) throw e;
      console.log('  [discover] wedged — retrying once…');
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  const map = new Map<string, noble.Characteristic>();
  for (const c of characteristics ?? []) {
    map.set(norm(c.uuid), c);
    console.log(`  [discover] char uuid=${c.uuid} props=${Object.keys(c.properties).join(',')}`);
  }
  return map;
}

async function main(): Promise<void> {
  console.log('\n  typecad-hal BLE central (noble)');
  console.log('  ------------------------------');
  console.log(`  scanning for advertised name "${DEVICE_NAME}"…\n`);

  // ── Wait for the adapter to power on ──
  await new Promise<void>((resolve, reject) => {
    const onState = (state: string): void => {
      if (state === 'poweredOn') { noble.removeListener('stateChange', onState); resolve(); }
      else if (state === 'unsupported' || state === 'unauthorized' || state === 'poweredOff') {
        noble.removeListener('stateChange', onState);
        reject(new Error(
          `Bluetooth adapter state is "${state}". ` +
          (state === 'unauthorized'
            ? 'Grant Bluetooth permission / check the WinUSB driver (Zadig).'
            : 'Is the adapter plugged in and the WinUSB driver bound?'),
        ));
      }
    };
    noble.on('stateChange', onState);
    setTimeout(() => reject(new Error('Adapter never reached poweredOn (stateChange timeout).')), 10_000);
  }).catch((err: Error) => fail(err.message));

  // ── Scan for the test peripheral by advertised name ──
  const peripheral = await Promise.race<noble.Peripheral>([
    new Promise<noble.Peripheral>((resolve) => {
      const onDiscover = (p: noble.Peripheral): void => {
        if (p.advertisement?.localName === DEVICE_NAME) {
          noble.removeListener('discover', onDiscover);
          noble.stopScanning(() => { /* ignore */ });
          resolve(p);
        }
      };
      noble.on('discover', onDiscover);
      // Scan with no UUID filter — the name match is the handshake.
      void noble.startScanningAsync(undefined, false).catch(() => { /* surfaced via timeout */ });
    }),
    timeout(SCAN_TIMEOUT_MS, 'scan for CuttlefishTest'),
  ]).catch((err: Error) => fail(`${err.message}. Is the peripheral flashed and advertising?`));

  record('advertise discovery (scanned for advertised name)', true, `rssi=${peripheral.rssi}`);

  // ── Connect ──
  await Promise.race([
    peripheral.connectAsync(),
    timeout(CONNECT_TIMEOUT_MS, 'connect'),
  ]).catch((err: Error) => fail(err.message));
  record('connect (central→peripheral)', true, `address=${peripheral.address}`);

  try {
    const chars = await Promise.race([
      loadCharacteristics(peripheral),
      timeout(GATT_TIMEOUT_MS, 'discover services + characteristics'),
    ]).catch((err: Error) => fail(err.message));

    // Helper that reads a char and records a numeric equality check.
    const readCheck = async (
      label: string, uuid: string, expected: number, read: (b: Buffer) => number,
    ): Promise<void> => {
      const c = chars.get(uuid);
      if (!c) { record(label, false, `characteristic ${uuid} not found`); return; }
      const data = await c.readAsync();
      const got = read(data);
      record(label, got === expected, `got=${got} expected=${expected}`);
    };

    // ── Read characteristics (multi-service: Environmental Sensing + Battery) ──
    await readCheck('read temperature (2A6E, int16)', TEMP_UUID, EXPECT_TEMP, readInt16LE);
    await readCheck('read humidity (2A6F, uint16)', HUMIDITY_UUID, EXPECT_HUMIDITY, readUInt16LE);
    await readCheck('read battery (2A19, uint8)', BATTERY_UUID, EXPECT_BATTERY, (b) => b.readUInt8(0));

    // ── Custom 128-bit UUID reads ──
    await readCheck('read custom 128-bit uint8', CUSTOM_UINT8_UUID, EXPECT_CUSTOM_UINT8, (b) => b.readUInt8(0));
    {
      const c = chars.get(CUSTOM_UTF8_UUID);
      if (!c) {
        record('read custom 128-bit utf8', false, `characteristic ${CUSTOM_UTF8_UUID} not found`);
      } else {
        const data = await c.readAsync();
        const got = data.toString('utf8');
        record('read custom 128-bit utf8', got === EXPECT_CUSTOM_UTF8, `got="${got}" expected="${EXPECT_CUSTOM_UTF8}"`);
      }
    }

    // ── Write + read-back (setpoint) ──
    // Proves the write path + the onRead echo of the stored value: write a new
    // value, then read it back and confirm the peripheral persisted it.
    {
      const c = chars.get(SETPOINT_UUID);
      if (!c) {
        record('write + read-back setpoint (2A1F)', false, `characteristic ${SETPOINT_UUID} not found`);
      } else {
        const before = readInt16LE(await c.readAsync());
        const beforeOk = before === EXPECT_SETPOINT_DEFAULT;
        record('setpoint reads default before write', beforeOk, `got=${before} expected=${EXPECT_SETPOINT_DEFAULT}`);

        const buf = Buffer.alloc(2);
        buf.writeInt16LE(WRITE_SETPOINT, 0);
        await c.writeAsync(buf, false);
        // Give the peripheral a beat to run the write callback + store the value.
        await new Promise((r) => setTimeout(r, 500));
        const after = readInt16LE(await c.readAsync());
        const afterOk = after === WRITE_SETPOINT;
        record('write + read-back setpoint (2A1F)', afterOk, `wrote=${WRITE_SETPOINT} readback=${after}`);
      }
    }

    // ── Subscribe + notify round-trip ──
    // The peripheral pushes an incrementing int16 on the notifier every 2 s.
    // Subscribe, wait for the first notification, assert the value matches the
    // NOTIFY_FIRST the shim started from.
    {
      const c = chars.get(NOTIFY_UUID);
      if (!c) {
        record('subscribe + notify round-trip (2A58)', false, `characteristic ${NOTIFY_UUID} not found`);
      } else {
        const notified = await Promise.race<number>([
          new Promise<number>((resolve, reject) => {
            c.on('data', (data: Buffer, isNotification: boolean) => {
              if (isNotification) resolve(readInt16LE(data));
            });
            // subscribeAsync enables notifications (writes the CCCD).
            void c.subscribeAsync().catch(reject);
          }),
          timeout(NOTIFY_TIMEOUT_MS, 'wait for notification'),
        ]).catch((err: Error) => { record('subscribe + notify round-trip (2A58)', false, err.message); return null; });

        if (notified !== null) {
          // The peripheral increments by 10 every push; accept the first value
          // >= the starting notify value (timing-dependent, so a floor check).
          const ok = notified >= EXPECT_NOTIFY_FIRST;
          record('subscribe + notify round-trip (2A58)', ok, `notified=${notified} (>= ${EXPECT_NOTIFY_FIRST})`);
        }
        try { await c.unsubscribeAsync(); } catch { /* best-effort */ }
      }
    }

    // ── Multi-service traversal ──
    // Confirm the GATT tree has more than one primary service (Environmental
    // Sensing 181A, Battery 180F, and the vendor 128-bit service). This is the
    // distinct-from-individual-reads proof that the multi-service lowering laid
    // the table out correctly.
    {
      const services = peripheral.services ?? [];
      const serviceCount = services.length;
      record('multi-service GATT tree discovered', serviceCount >= 2, `services=${serviceCount}`);
    }
  } finally {
    // ── Disconnect ── exercises the peripheral's onDisconnect callback ──
    try {
      await peripheral.disconnectAsync();
      record('disconnect (clean)', true, '');
    } catch (err) {
      record('disconnect (clean)', false, (err as Error).message);
    }
    try { noble.stopScanning(() => { /* ignore */ }); } catch { /* ignore */ }
  }

  // ── Summary ──
  const passed = checks.filter((c) => c.pass).length;
  const failed = checks.length - passed;
  console.log(`\n  Checks   ${passed} passed, ${failed} failed (${checks.length} total)`);
  console.log(`  Device   ${DEVICE_NAME} @ ${peripheral.address}`);
  console.log(`  ${failed === 0 ? 'PASS  All checks passed' : 'FAIL  One or more checks failed'}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n  Unexpected error:', err);
  process.exit(1);
});
