// ---------------------------------------------------------------------------
// Example 5 — I2C Sensor Read
//
// Initialize Wire (I2C0), talk to a BME280 at 0x76, and print temperature.
// ---------------------------------------------------------------------------

import { I2C0, Serial } from '../code/board-arduino-uno/peripherals';
import { delay }        from '../code/board-arduino-uno/timing';

Serial.initialize({ baudRate: 9600 });
I2C0.initialize();

const BME280_ADDR = 0x76;

while (true) {
  const tempRaw = I2C0.readWord(BME280_ADDR, 0xFA);
  const temperature = tempRaw / 100.0;
  Serial.println(temperature);
  delay(1000);
}
