// BLE diagnostic: the full GATT table + periodic link-state prints.
import { BLE, BlePerm, BleValueType, Time } from '@typecad/hal';

const ble = new BLE('CuttlefishTest');

let setpoint: number = 2000;
function onSetpointWrite(value: number): void { setpoint = value; }
let connects: number = 0;
function onBleConnect(): void { connects = connects + 1; }

ble.char('2A6E', BleValueType.Int16, BlePerm.Read).onRead((): number => 2180);
ble.char('2A1F', BleValueType.Int16, BlePerm.Read | BlePerm.Write)
  .onRead((): number => setpoint)
  .onWrite(onSetpointWrite);
ble.char('2A58', BleValueType.Int16, BlePerm.Read | BlePerm.Notify).onRead((): number => 2200);
ble.char('2A6F', BleValueType.Uint16, BlePerm.Read).onRead((): number => 5500);
ble.char('2A19', BleValueType.Uint8, BlePerm.Read).onRead((): number => 87);
ble.char('a1b2c3d4-0010-1000-8000-00805f9b34fb', BleValueType.Uint8, BlePerm.Read).onRead((): number => 42);
ble.char('a1b2c3d4-0011-1000-8000-00805f9b34fb', BleValueType.Utf8, BlePerm.Read).onRead((): string => 'typecad-hal-ble');
ble.onConnect(onBleConnect);

ble.start();
console.log('diag: server started');

while (true) {
  console.log('diag: linked=' + (ble.linked() ? 1 : 0) + ' clients=' + ble.clients() + ' setpoint=' + setpoint + ' connects=' + connects);
  if (ble.linked()) {
    ble.notify(2, 2200);
  }
  Time.sleep(2000);
}
