// ---------------------------------------------------------------------------
// Example 5a — I2C Sensor Read (Basic Wire API)
//
// Demonstrates basic I2C master mode communication with a BME280 sensor.
// Shows: begin(), setClock(), beginTransmission(), write(), endTransmission(),
//        requestFrom(), available(), read()
// ---------------------------------------------------------------------------

import { I2C0, UART0, delay } from '@typecode';

// Initialize UART0 for debug output
UART0.config.baudRate(9600).begin();

// Initialize I2C as master
I2C0.config.begin();

const BME280_ADDR = 0x76;

// Main loop
while (true) {
  // Read 2 bytes from register 0xFA (temperature data)
  const tempData = I2C0.device(BME280_ADDR).readBytes(0xfa, 2);

  // Access bytes directly from returned Uint8Array
  const msb = tempData[0];
  const lsb = tempData[1];

  // Combine into raw temperature value
  const tempRaw = (msb << 8) | lsb;
  const temperature = tempRaw / 100.0;
  UART0.println(temperature);


  delay(1000);
}