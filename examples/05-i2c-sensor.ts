// ---------------------------------------------------------------------------
// Example 5a — I2C Sensor Read (Basic Wire API)
//
// Demonstrates basic I2C master mode communication with a BME280 sensor.
// Shows: begin(), setClock(), beginTransmission(), write(), endTransmission(),
//        requestFrom(), available(), read()
// ---------------------------------------------------------------------------

import { I2C0, UART0 } from '@typecode/board-arduino-uno/arduino';
import { delay }        from '@typecode/board-arduino-uno';

// Initialize UART0 for debug output
UART0.begin(9600);

// Initialize I2C as master with 400kHz fast mode
I2C0.begin();
I2C0.setClock(400000);

const BME280_ADDR = 0x76;

// Main loop
while (true) {
  // Write register pointer to 0xFA (temperature MSB)
  I2C0.beginTransmission(BME280_ADDR);
  I2C0.write(0xFA);
  const status = I2C0.endTransmission();
  
  if (status === 0) {
    // Request 2 bytes (temperature MSB and LSB)
    const bytesAvailable = I2C0.requestFrom(BME280_ADDR, 2);
    
    if (bytesAvailable > 0) {
      // Read the two bytes
      const msb = I2C0.read();
      const lsb = I2C0.read();
      
      // Combine into raw temperature value
      const tempRaw = (msb << 8) | lsb;
      const temperature = tempRaw / 100.0;
      UART0.println(temperature);
    }
  } else {
    UART0.println(`I2C error: ${status}`);
  }
  
  delay(1000);
}