// 04 — notify: push updated values to subscribed clients.
// Temperature characteristic with READ|NOTIFY. Ble.notify() pushes to
// subscribed clients on the current characteristic.
import { Ble, delay, BleValueType, BlePerm } from '@typecad/hal';

Ble.server('Notifier')
  .characteristic('2A6E', BleValueType.Int16, BlePerm.Read | BlePerm.Notify)
  .onRead(() => 2180);

Ble.server('Notifier').begin();
console.log('advertising with notify');

while (true) {
  delay(2000);
  Ble.notify(0, 2200);
  console.log(`clients: ${Ble.clientCount()}`);
}

