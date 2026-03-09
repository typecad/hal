// ---------------------------------------------------------------------------
// Example 5h — I2C Fluent Read API (Experimental)
//
// Demonstrates the fluent chainable read API for I2C.
// Shows: I2C0.device(addr).read(count).from(register)
//        Result.ok, Result.asUint8(), Result.asUint16()
//
// NOTE: This API is type-safe but requires transpiler support for
// generating Wire calls. Currently experimental.
// ---------------------------------------------------------------------------

import { I2C0, UART0, delay } from '@typecode';

UART0.config.baudRate(9600).begin();

// Initialize using fluent config
I2C0.config
  .speed(400000)
  .begin();

const BME280_ADDR = 0x76;

// Main loop
while (true) {
  // Fluent read: read 2 bytes from register 0xFA
  // Returns I2CReadResult with ok status and data methods
  const result = I2C0.device(BME280_ADDR).read(2).from(0xFA);
  
  if (result.ok) {
    // asUint16('be') = big-endian, asUint16('le') = little-endian
    const tempRaw = result.asUint16('be');
    const temperature = tempRaw / 100.0;
    UART0.println(temperature);
  } else {
    // Error handling with status
    UART0.println(`I2C read failed: ${result.status}`);
  }
  
  delay(1000);
}
