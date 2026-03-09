// ---------------------------------------------------------------------------
// Example 5g — I2C Fluent API Configuration
//
// Demonstrates the fluent chainable configuration API for I2C.
// Shows: I2C0.config.speed().begin()
// ---------------------------------------------------------------------------

import { I2C0, UART0, delay } from '@typecode';

// Initialize UART0 for debug output with fluent config
UART0.config.baudRate(9600).begin();

// Fluent configuration - chain methods to set up I2C
I2C0.config
  .speed(400000)    // 400kHz fast mode
  .begin();         // Initialize

UART0.println("I2C initialized with fluent API");

const BME280_ADDR = 0x76;

// Main loop using fluent read API
while (true) {
  // Read 2 bytes from register 0xFA (temperature data)
  const result = I2C0.device(BME280_ADDR).read(2).from(0xFA);
  
  if (result.ok) {
    const tempRaw = (result.value[0] << 8) | result.value[1];
    UART0.println(tempRaw / 100.0);
  } else {
    UART0.println("Read failed");
  }
  
  delay(1000);
}
