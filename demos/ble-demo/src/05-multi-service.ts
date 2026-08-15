// 05 — multiple characteristics on one server.
// Environmental Sensing temperature + humidity + battery level, all readable.
import { Ble, delay, BleValueType, BlePerm } from '@typecad/hal';

Ble.server('MultiSensor')
  .characteristic('2A6E', BleValueType.Int16, BlePerm.Read)
  .onRead(() => 2180);

Ble.server('MultiSensor')
  .characteristic('2A6F', BleValueType.Uint16, BlePerm.Read)
  .onRead(() => 5500);

Ble.server('MultiSensor')
  .characteristic('2A19', BleValueType.Uint8, BlePerm.Read)
  .onRead(() => batteryPct);

Ble.server('MultiSensor').begin();
console.log('advertising 3 characteristics');

let batteryPct = 87;

while (true) {
  delay(5000);
  batteryPct = batteryPct > 20 ? batteryPct - 1 : 100;
  console.log(`battery=${batteryPct}%`);
}
