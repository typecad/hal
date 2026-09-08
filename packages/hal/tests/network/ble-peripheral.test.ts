// Hardware test for the @typecad/hal thin BLE GATT peripheral.
//
// The inverse of http-client.test.ts: there the firmware is the HTTP client and
// the host runs the server; here the firmware is the GATT PERIPHERAL (it
// advertises) and the host PC is the GATT central (ble-client.ts (this directory),
// driven by `npm run test:ble`). This test advertises "CuttlefishTest", exposes
// the characteristic set the central expects, then asserts the
// peripheral-visible side of the link while the host central connects and
// exercises GATT.
//
// Two-terminal flow (mirrors test:http / test:hw:http):
//   Terminal 1 (peripheral — this file):  npm run test:hw:ble
//   Terminal 2 (central — host noble):    npm run test:ble
//
// The BLE link itself is the coordination, exactly like mqtt-client.test.ts
// busy-waits on the broker: the host central connecting flips linked()
// on the peripheral, the write callback fires when the host writes the
// setpoint, and onConnect increments a counter the test asserts.
//
// The @typecad/hal/testing harness has no async/await, so every wait uses the
// blocking top-level form: a for-loop pumping Time.sleep until the central's
// activity shows up. Values are passed inline to .expect() via IIFEs (see
// http-client.test.ts) so the preprocessor hoists them as `: number` for the
// printf %g format check under GCC 15 -Werror=format=.

import { describe, done } from '@typecad/hal/testing';
import { BLE, Time, BleValueType, BlePerm } from '@typecad/hal';

// Fixed values the host central asserts on its side. Duplicated in
// ble-client.ts. Written as FLOAT literals (.0) so the transpiler types them
// double — the Zephyr BLE read dispatcher casts each handler to
// double(*)(void); an int-returning handler read as double is r0:r1 UB on
// Cortex-M4F (every read comes back 0).
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
// Layout matches ble-client.ts so the host central's UUIDs line up. The
// advertised name is the BLE construction fact; each characteristic's
// uuid/type/perms ride its char() op (declaration order = the notify index).
const ble = new BLE('CuttlefishTest');

ble.char('2A6E', BleValueType.Int16, BlePerm.Read)
  .onRead((): number => TEMP_VALUE);

ble.char('2A1F', BleValueType.Int16, BlePerm.Read | BlePerm.Write)
  .onRead((): number => setpoint)
  .onWrite(onSetpointWrite);

ble.char('2A58', BleValueType.Int16, BlePerm.Read | BlePerm.Notify)
  .onRead((): number => 2200.0);

ble.char('2A6F', BleValueType.Uint16, BlePerm.Read)
  .onRead((): number => HUMIDITY_VALUE);

ble.char('2A19', BleValueType.Uint8, BlePerm.Read)
  .onRead((): number => BATTERY_VALUE);

ble.char('a1b2c3d4-0010-1000-8000-00805f9b34fb', BleValueType.Uint8, BlePerm.Read)
  .onRead((): number => 42.0);

ble.char('a1b2c3d4-0011-1000-8000-00805f9b34fb', BleValueType.Utf8, BlePerm.Read)
  .onRead((): string => 'typecad-hal-ble');

ble.onConnect(onBleConnect);

ble.start();

// ── Stack-up ──────────────────────────────────────────────────────────────
// Give the stack a beat to settle before the central arrives; the host's scan
// finding "CuttlefishTest" is the real advertising proof.

describe('BLE peripheral — advertising')
  .it('start() brings the stack up and returns (no hang)')
    .expect((() => { Time.sleep(2000); return Time.now() > 0 ? 1 : 0; })()).toBe(1);

// ── Central connects ──────────────────────────────────────────────────────
// The host central (Terminal 2) scans for CuttlefishTest and connects. We
// busy-wait until linked() flips, then assert clients() is 1 and the connect
// callback fired. ~30 s headroom covers slow BLE discovery + GATT.

describe('BLE peripheral — central connect')
  .it('linked() is true after the central connects')
    .expect((() => {
      for (let i = 0; i < 600; i++) { Time.sleep(100); if (ble.linked()) break; }
      return ble.linked() ? 1 : 0;
    })()).toBe(1)
  .it('clients() is 1 with one central attached')
    .expect((() => { return ble.clients() === 1 ? 1 : 0; })()).toBe(1)
  .it('onConnect callback fired exactly once')
    .expect((() => { return connectedCount; })()).toBe(1);

// ── Write round-trip (host writes setpoint, peripheral echoes) ────────────
// The host writes 2350 to the setpoint char. The onWrite handler stores it in
// `setpoint`, which onRead echoes. We wait for the write to land, then confirm
// the stored value changed from the default.

describe('BLE peripheral — central write round-trip')
  .it('setpoint updated by the central write')
    .expect((() => {
      for (let i = 0; i < 300; i++) { Time.sleep(100); if (setpoint !== SETPOINT_DEFAULT) break; }
      return setpoint;
    })()).toBe(2350);

// ── Notify push (peripheral→central) ──────────────────────────────────────
// Push an int16 on the notifier char (declaration index 2 — see the char()
// order above). The host central subscribes and asserts the value; here we
// confirm the push doesn't drop the link.

describe('BLE peripheral — notify push')
  .it('notify() pushes to the subscribed central without dropping the link')
    .expect((() => {
      // Assert right after the first push (the central is mid-suite, link
      // provably up), then keep pushing through its subscription window —
      // the central subscribes AFTER its setpoint write, so later pushes
      // are the ones it receives. Post-disconnect pushes are no-ops.
      // Let the central's CCC subscription write land first — a notify
      // racing the in-flight subscribe asserted the ESP32 controller.
      Time.sleep(1500);
      ble.notify(2, 2200);
      Time.sleep(500);
      const held: number = ble.linked() ? 1 : 0;
      for (let i = 0; i < 4; i++) {
        if (!ble.linked()) break;
        ble.notify(2, 2200);
        Time.sleep(2000);
      }
      return held;
    })()).toBe(1);

// ── Central disconnects ───────────────────────────────────────────────────
// The host central disconnects at the end of its suite. We busy-wait until the
// link drops, then assert clients() returns to 0. This exercises the onDrop
// path in the lowering.

describe('BLE peripheral — central disconnect')
  .it('clients() returns to 0 after the central disconnects')
    .expect((() => {
      for (let i = 0; i < 300; i++) { Time.sleep(100); if (!ble.linked()) break; }
      return ble.clients() === 0 ? 1 : 0;
    })()).toBe(1);

done();
