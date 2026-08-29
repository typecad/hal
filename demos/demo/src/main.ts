// 01 — minimal: advertise a GATT server with one read-only characteristic.
// Environmental Sensing Temperature (2A6E), int16, read-only.
import { BLE, BleValueType, BlePerm, Time } from '@typecad/hal';

function readTemp(): number {
  return 2180; // 21.80 °C (int16, 0.01 °C units per GATT 2A6E)
}

const ble = new BLE('TempSensor');

ble.char('2A6E', BleValueType.Int16, BlePerm.Read)
  .onRead((): number => readTemp());

ble.start();
console.log('advertising');

while (true) {
  Time.sleep(1000);
}
