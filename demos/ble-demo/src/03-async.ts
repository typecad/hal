// 03 — async/await: cooperative wait-for-connect while a heartbeat runs.
// Each async function becomes a state-machine task driven from loop(). The
// awaited Ble.untilConnected() lowers to a start + poll state pair (no
// blocking wait), so the heartbeat keeps printing while BLE waits for a
// central to connect.
import { Ble, delay, BleValueType, BlePerm } from '@typecad/hal';

Ble.server('AsyncSensor')
  .characteristic('2A6E', BleValueType.Int16, BlePerm.Read)
  .onRead(() => 2180)
  .onConnect(() => { console.log('connected'); })
  .onDisconnect(() => { console.log('disconnected'); });

Ble.server('AsyncSensor').begin();

// Linear task: wait for a central, then log.
async function waitForClient() {
  console.log('waiting for central...');
  await Ble.untilConnected(30000);
  console.log('central connected!');
}

// Cyclic task: heartbeat to prove the state machine is cooperative.
async function heartbeat() {
  while (true) {
    console.log('heartbeat');
    await delay(1000);
  }
}

waitForClient();
heartbeat();
