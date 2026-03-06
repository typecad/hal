// ---------------------------------------------------------------------------
// Example 5g — I2C Fluent API Configuration (Experimental)
//
// Demonstrates the fluent chainable configuration API for I2C.
// Shows: I2C0.config.speed().sda().scl().begin()
//
// NOTE: This API is type-safe but requires transpiler support for
// generating Wire calls. Currently experimental.
// ---------------------------------------------------------------------------

import { I2C0, UART0 } from '@typecode/board-arduino-uno';
import { delay }        from '@typecode/board-arduino-uno';

UART0.initialize({ baudRate: 9600 });

// Fluent configuration - chain methods to set up I2C
I2C0.config
  .speed(400000)    // 400kHz fast mode
  .begin();         // Initialize

UART0.println("I2C initialized with fluent API");

const BME280_ADDR = 0x76;

// Main loop
while (true) {
  // Read using Wire-compatible API (fluent read API is experimental)
  I2C0.beginTransmission(BME280_ADDR);
  I2C0.write(0xFA);
  I2C0.endTransmission();
  
  I2C0.requestFrom(BME280_ADDR, 2);
  const tempRaw = (I2C0.read() << 8) | I2C0.read();
  UART0.println(tempRaw / 100.0);
  
  delay(1000);
}
