// BLE minimal server: advertise a GATT server with one read-only characteristic.
// Environmental Sensing Temperature (2A6E), int16, read-only.

import { Ble, delay, BleValueType, BlePerm } from '@typecad/hal';

function setup(): void {
  Ble.server('TempSensor')
    .characteristic('2A6E', BleValueType.Int16, BlePerm.Read)
    .onRead(() => 2180); // 21.80 °C (int16, 0.01 °C units per GATT 2A6E)
  Ble.server('TempSensor').begin();
}

function loop(): void {
  delay(1000);
}
