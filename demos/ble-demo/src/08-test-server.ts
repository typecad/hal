// 08 — combined test peripheral for the on-hardware BLE suite.
//
// The inverse of the HTTP test: here the firmware is the GATT peripheral and
// the host PC (packages/hal/tests/network/ble-client.ts, noble) is the central. This
// server advertises one device name and exposes every feature the host central
// probes, so a single flash covers the whole suite:
//
//   • advertise discovery        — name "CuttlefishTest" (host scans for it)
//   • read                       — temperature 2A6E (int16), humidity 2A6F (uint16)
//   • write + read-back          — setpoint 2A1F (int16 read+write); the write
//                                  handler stores the value, onRead echoes it
//   • notify / subscribe         — notifier 2A58 (int16 read+notify), pushed
//                                  every 2 s via Ble.notify(index, value)
//   • multi-service              — Environmental Sensing (181A) + Battery (180F)
//   • custom 128-bit UUID        — vendor service + uint8 + utf8 read chars
//   • connect/disconnect status  — handlers flip a global the host verifies by
//                                  connecting then disconnecting
//
// Characteristic indices are passed explicitly to Ble.notify() (not the
// instance .notify()) so the index is a literal the resolver tracks — matching
// the 04-notify demo pattern. Indices are assigned in declaration order:
//   0 temperature  1 setpoint  2 notifier  3 humidity  4 battery
//   5 custom-uint8 6 custom-utf8
// Keep these in sync with ble-client.ts (NOTIFY_CHAR_INDEX, SETPOINT_UUID, …).
//
// Build as the ble-demo entry:
//   cd demos/ble-demo && npx cuttlefish build --entry ./src/08-test-server.ts \
//     --compile --upload --port COM10

import { Ble, delay, BleValueType, BlePerm } from '@typecad/hal';

// Advertised device name — the host central filters on this exact string.
// A unique name is what makes the test deterministic among the many BLE
// devices in a room (the test does not rely on a MAC).
//
// NB: inlined as the literal 'CuttlefishTest' in every Ble.server() call below,
// not hoisted via a const. The transpiler drops a top-level const whose only
// references are HAL op call arguments (it can't see the dependency through the
// semantic-op boundary), so a const would leave __tc_ble_set_name referencing an
// undeclared identifier. This mirrors the mqtt-client.test.ts broker-URI note.

// Fixed values the host central asserts. Written as FLOAT literals (the trailing
// .0) so the transpiler types them `double`, not `int`. This matters because
// the Zephyr BLE read dispatcher (__tc_ble_attr_read) casts each hoisted read
// handler to `double(*)(void)` and calls it through that pointer — an
// int-returning handler read as a double is the r0:r1 UB the codebase flags
// (every read comes back 0 on Cortex-M4F). The .0 keeps the cast sound.
const TEMP_VALUE = 2180.0;      // 21.80 °C (int16, 0.01 °C/LSB per GATT 2A6E)
const HUMIDITY_VALUE = 5500.0;  // 55.00 % (uint16, 0.01 %/LSB per GATT 2A6F)
const BATTERY_VALUE = 87.0;     // 87 % (uint8 per GATT 2A19)
const CUSTOM_UINT8_VALUE = 42.0;
const CUSTOM_UTF8_VALUE = 'cuttlefish-ble';
const SETPOINT_DEFAULT = 2000.0;  // 20.00 °C
const NOTIFY_FIRST = 2200.0;      // first pushed notify value (int16)

// Write-back store: the setpoint write handler updates this, onRead echoes it.
// Initialized to the default so the first read (before any write) is stable.
//
// NB: reassigned inside onSetpointWrite / onBleConnect / onBleDisconnect below.
// The transpiler's whole-program const-suggestion only sees assignments to a
// `let` when they occur in a *named top-level function body* (it walks
// program.functions); arrows passed inline to a HAL call register as ISR
// thunks and their assignments are invisible to that scan, so the binding is
// wrongly promoted to `const` and the write silently no-ops. Keeping the
// mutation in named functions (like mqtt-client.test.ts's onMessage) makes the
// reassignment visible and keeps the binding mutable.
let setpoint: number = SETPOINT_DEFAULT;

// Connect/disconnect bookkeeping the host central verifies by connecting then
// dropping. Updated from the named callbacks below (see the NB above).
let connectedCount: number = 0;
let disconnectedCount: number = 0;

/** Setpoint write handler — stores the central-supplied value for onRead echo. */
function onSetpointWrite(value: number): void {
  setpoint = value;
}

/** Connect handler — increments the counter the test asserts. */
function onBleConnect(): void {
  connectedCount = connectedCount + 1;
}

/** Disconnect handler — increments the counter the test asserts. */
function onBleDisconnect(): void {
  disconnectedCount = disconnectedCount + 1;
}

// ── Service 1: Environmental Sensing (181A) ──
// Temperature (read) + Setpoint (read+write) + Notifier (read+notify).
Ble.server('CuttlefishTest')
  .characteristic('2A6E', BleValueType.Int16, BlePerm.Read)
  .onRead(() => TEMP_VALUE);

Ble.server('CuttlefishTest')
  .characteristic('2A1F', BleValueType.Int16, BlePerm.Read | BlePerm.Write)
  .onRead(() => setpoint)
  .onWrite(onSetpointWrite);

Ble.server('CuttlefishTest')
  .characteristic('2A58', BleValueType.Int16, BlePerm.Read | BlePerm.Notify)
  .onRead(() => NOTIFY_FIRST);

// ── Service 2: Battery Level (180F) ──
// Humidity rides in Environmental Sensing; battery is its own service so the
// host central sees a genuine multi-service tree.
Ble.server('CuttlefishTest')
  .characteristic('2A6F', BleValueType.Uint16, BlePerm.Read)
  .onRead(() => HUMIDITY_VALUE);

Ble.server('CuttlefishTest')
  .characteristic('2A19', BleValueType.Uint8, BlePerm.Read)
  .onRead(() => BATTERY_VALUE);

// ── Service 3: vendor-specific (128-bit UUIDs) ──
// Exercises the __tc_ble_uuid_is_128 / __tc_ble_uuid128_parse path in the
// Zephyr lowering. Two chars on one custom service.
Ble.server('CuttlefishTest')
  .characteristic('a1b2c3d4-0010-1000-8000-00805f9b34fb', BleValueType.Uint8, BlePerm.Read)
  .onRead(() => CUSTOM_UINT8_VALUE);

Ble.server('CuttlefishTest')
  .characteristic('a1b2c3d4-0011-1000-8000-00805f9b34fb', BleValueType.Utf8, BlePerm.Read)
  .onRead(() => CUSTOM_UTF8_VALUE);

// Connect/disconnect callbacks flip the counters the host central implicitly
// drives by connecting and then disconnecting at the end of the suite.
Ble.server('CuttlefishTest')
  .onConnect(onBleConnect);
Ble.server('CuttlefishTest')
  .onDisconnect(onBleDisconnect);

Ble.server('CuttlefishTest').begin();
console.log('advertising CuttlefishTest');

// Notify loop: push an incrementing value on the notifier char (index 2) every
// 2 s. The host central subscribes, then waits for a notification and asserts
// the value matches the int16 the shim pushes.
let notifyValue: number = NOTIFY_FIRST;
while (true) {
  delay(2000);
  Ble.notify(2, notifyValue);
  notifyValue = notifyValue + 10;
}
