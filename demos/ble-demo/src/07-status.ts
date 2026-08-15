// 07 — status queries and connection monitoring.
// Polls BLE link state and logs connect/disconnect transitions.
import { Ble, BleStatus, delay, BleValueType, BlePerm } from '@typecad/hal';

Ble.server('StatusDemo')
  .characteristic('2A6E', BleValueType.Int16, BlePerm.Read)
  .onRead(() => 2180);

Ble.server('StatusDemo').begin();

let wasConnected = false;

while (true) {
  const connected = Ble.isConnected();
  if (connected !== wasConnected) {
    wasConnected = connected;
    console.log(connected ? 'central connected' : 'central disconnected');
    console.log(`clients: ${Ble.clientCount()}`);
  }
  if (Ble.status() === BleStatus.Error) {
    console.log('BLE error');
  }
  delay(500);
}
