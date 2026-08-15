// 06 — custom 128-bit UUIDs for vendor-specific services.
// The raw-UUID escape hatch: pass any 128-bit string instead of a 16-bit SIG UUID.
import { Ble, delay, BleValueType, BlePerm } from '@typecad/hal';

Ble.server('CustomDevice')
  .characteristic('a1b2c3d4-0000-1000-8000-00805f9b34fb', BleValueType.Uint8, BlePerm.Read)
  .onRead(() => 42);

Ble.server('CustomDevice')
  .characteristic('a1b2c3d4-0001-1000-8000-00805f9b34fb', BleValueType.Utf8, BlePerm.Read)
  .onRead(() => 'hello ble');

Ble.server('CustomDevice').begin();

while (true) {
  delay(1000);
}
