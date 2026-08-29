// BLE minimal server: advertise a GATT server with one read-only characteristic.
// Environmental Sensing Temperature (2A6E), int16, read-only.

import { BLE, BleValueType, BlePerm, Time } from '@typecad/hal';

const ble = new BLE('TempSensor');

ble.char('2A6E', BleValueType.Int16, BlePerm.Read)
  .onRead((): number => 2180);   // 21.80 °C (int16, 0.01 °C units per GATT 2A6E)

ble.start();

while (true) {
  Time.sleep(1000);
}
