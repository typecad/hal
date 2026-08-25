// Hardware test for the @typecad/hal BLE peripheral (NimBLE GATT server).
//
// The inverse of http-client.test.ts: there the firmware is the HTTP client and
// the host runs the server; here the firmware is the GATT PERIPHERAL (it
// advertises) and the host PC is the GATT central (ble-client.ts (this directory),
// driven by `npm run test:ble`). This test advertises "CuttlefishTest", exposes
// the same characteristic set as demos/ble-demo/src/08-test-server.ts, then
// asserts the peripheral-visible side of the link while the host central
// connects and exercises GATT.
//
// Two-terminal flow (mirrors test:http / test:hw:http):
//   Terminal 1 (peripheral — this file):  npm run test:hw:ble -- --port COM10
//   Terminal 2 (central — host noble):    npm run test:ble
//
// The BLE link itself is the coordination, exactly like mqtt-client.test.ts
// busy-waits on the broker: the host central connecting flips Ble.isConnected()
// to true on the peripheral, the write callback fires when the host writes the
// setpoint, and onConnect/onDisconnect increment counters the test asserts.
//
// The @typecad/expect harness has no async/await, so every wait uses the
// blocking top-level form: a for-loop pumping Timing.delay until the central's
// activity shows up. Values are passed inline to .expect() via IIFEs (see
// http-client.test.ts) so the preprocessor hoists them as `: number` for the
// printf %g format check under GCC 15 -Werror=format=.

import { describe, done } from '@typecad/expect';
import { Ble, Timing, BleValueType, BlePerm } from '@typecad/hal';

// Advertised device name — the host central scans for this exact string.
//
// NB: inlined as the literal 'CuttlefishTest' in every Ble.server() call below,
// not hoisted via a const. The transpiler drops a top-level const whose only
// references are HAL op call arguments, so a const would leave
// __tc_ble_set_name referencing an undeclared identifier. Mirrors the
// mqtt-client.test.ts broker-URI note.

// Fixed values the host central asserts on its side. Duplicated in
// ble-client.ts and 08-test-server.ts. Written as FLOAT literals (.0) so the
// transpiler types them double — the Zephyr BLE read dispatcher casts each
// handler to double(*)(void); an int-returning handler read as double is r0:r1
// UB on Cortex-M4F (every read comes back 0). See 08-test-server.ts note.
const TEMP_VALUE = 2180.0;
const HUMIDITY_VALUE = 5500.0;
const BATTERY_VALUE = 87.0;
const SETPOINT_DEFAULT = 2000.0;

// Peripheral-side state flipped by the BLE event callbacks. The test busy-waits
// on these the same way mqtt-client.test.ts waits on the onMessage global.
//
// NB: reassigned inside onSetpointWrite / onBleConnect below. The transpiler's
// const-suggestion only sees assignments to a `let` in *named top-level
// function bodies*; inline arrows passed to a HAL call register as ISR thunks
// whose assignments are invisible to that scan, so the binding is wrongly
// promoted to `const` and the write silently no-ops. Keep the mutation in a
// named function (like mqtt-client.test.ts's onMessage).
let setpoint: number = SETPOINT_DEFAULT;
let connectedCount: number = 0;

/** Setpoint write handler — stores the central-supplied value for onRead echo. */
function onSetpointWrite(value: number): void {
  setpoint = value;
}

/** Connect handler — increments the counter the test asserts. */
function onBleConnect(): void {
  connectedCount = connectedCount + 1;
}

// ── GATT table: Environmental Sensing + Battery + vendor 128-bit ──────────
// Layout matches 08-test-server.ts so the host central's UUIDs line up.
Ble.server('CuttlefishTest')
  .characteristic('2A6E', BleValueType.Int16, BlePerm.Read)
  .onRead(() => TEMP_VALUE);

Ble.server('CuttlefishTest')
  .characteristic('2A1F', BleValueType.Int16, BlePerm.Read | BlePerm.Write)
  .onRead(() => setpoint)
  .onWrite(onSetpointWrite);

Ble.server('CuttlefishTest')
  .characteristic('2A58', BleValueType.Int16, BlePerm.Read | BlePerm.Notify)
  .onRead(() => 2200.0);

Ble.server('CuttlefishTest')
  .characteristic('2A6F', BleValueType.Uint16, BlePerm.Read)
  .onRead(() => HUMIDITY_VALUE);

Ble.server('CuttlefishTest')
  .characteristic('2A19', BleValueType.Uint8, BlePerm.Read)
  .onRead(() => BATTERY_VALUE);

Ble.server('CuttlefishTest')
  .characteristic('a1b2c3d4-0010-1000-8000-00805f9b34fb', BleValueType.Uint8, BlePerm.Read)
  .onRead(() => 42.0);

Ble.server('CuttlefishTest')
  .characteristic('a1b2c3d4-0011-1000-8000-00805f9b34fb', BleValueType.Utf8, BlePerm.Read)
  .onRead(() => 'cuttlefish-ble');

Ble.server('CuttlefishTest')
  .onConnect(onBleConnect);

Ble.server('CuttlefishTest').begin();

// ── Advertising ──────────────────────────────────────────────────────────
// After begin(), status moves Idle(0)→Initializing(1)→Advertising(2). Give the
// stack a beat to settle before asserting, then confirm we are advertising so a
// failure to even start BLE surfaces immediately (rather than as a host-side
// scan timeout).

describe('BLE peripheral — advertising')
  .it('status is Advertising after begin()')
    .expect((() => { Timing.delay(2000); return Ble.status() === 2 ? 1 : 0; })()).toBe(1);

// ── Central connects ─────────────────────────────────────────────────────
// The host central (Terminal 2) scans for CuttlefishTest and connects. We
// busy-wait until isConnected() flips, then assert clientCount is 1 and the
// connect callback fired. ~30 s headroom covers slow BLE discovery + GATT.

describe('BLE peripheral — central connect')
  .it('isConnected() is true after the central connects')
    .expect((() => {
      for (let i = 0; i < 300; i++) { Timing.delay(100); if (Ble.isConnected()) break; }
      return Ble.isConnected() ? 1 : 0;
    })()).toBe(1)
  .it('clientCount() is 1 with one central attached')
    .expect((() => { return Ble.clientCount() === 1 ? 1 : 0; })()).toBe(1)
  .it('onConnect callback fired exactly once')
    .expect((() => { return connectedCount; })()).toBe(1);

// ── Write round-trip (host writes setpoint, peripheral echoes) ───────────
// The host writes 2350 to the setpoint char. The onWrite handler stores it in
// `setpoint`, which onRead echoes. We wait for the write to land, then confirm
// the stored value changed from the default.

describe('BLE peripheral — central write round-trip')
  .it('setpoint updated by the central write')
    .expect((() => {
      for (let i = 0; i < 100; i++) { Timing.delay(100); if (setpoint !== SETPOINT_DEFAULT) break; }
      return setpoint;
    })()).toBe(2350);

// ── Notify push (peripheral→central) ─────────────────────────────────────
// Push an int16 on the notifier char (index 2 — see 08-test-server.ts layout)
// every 2 s. The host central subscribes and asserts the value; here we only
// confirm the push call path doesn't error (a failed notify would leave the
// status intact, so we re-check connectivity held through the push).

describe('BLE peripheral — notify push')
  .it('notify() pushes to subscribed central without dropping the link')
    .expect((() => {
      Ble.notify(2, 2200);
      Timing.delay(500);
      return Ble.isConnected() ? 1 : 0;
    })()).toBe(1);

// ── Central disconnects ──────────────────────────────────────────────────
// The host central disconnects at the end of its suite. We busy-wait until the
// link drops, then assert clientCount returns to 0. This exercises the
// onDisconnect path in the lowering.

describe('BLE peripheral — central disconnect')
  .it('clientCount() returns to 0 after the central disconnects')
    .expect((() => {
      for (let i = 0; i < 150; i++) { Timing.delay(100); if (!Ble.isConnected()) break; }
      return Ble.clientCount() === 0 ? 1 : 0;
    })()).toBe(1);

done();
