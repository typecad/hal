// 02 — configured server: TX power, multiple characteristics with read+write.
// Temperature (read-only) + Setpoint (read+write).
import { Ble, delay, BleValueType, BlePerm } from '@typecad/hal';

Ble.txPower(9);

Ble.server('Thermostat')
  .characteristic('2A6E', BleValueType.Int16, BlePerm.Read)
  .onRead(() => 2180);

Ble.server('Thermostat')
  .characteristic('2A1F', BleValueType.Int16, BlePerm.Read | BlePerm.Write)
  .onRead(() => 2000)
  .onWrite(value => { console.log(`write: ${value}`); });

Ble.server('Thermostat').begin();
console.log('advertising');

while (true) {
  delay(2000);
}
