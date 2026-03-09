// ---------------------------------------------------------------------------
// Example 5i — I2C Fluent Write API
//
// Demonstrates the fluent chainable write API for I2C.
// Shows: I2C0.device(addr).write(data).to(register)
//        I2CWriteResult.ok, I2CStatus enum
// ---------------------------------------------------------------------------

import { I2C0, UART0, delay } from '@typecode';
import { I2CStatus } from '@typecode/core';

// Initialize UART0 for debug output
UART0.config.baudRate(9600).begin();

// Initialize using fluent config
I2C0.config
  .speed(400000)
  .begin();

const BME280_ADDR = 0x76;

// Fluent write: write single byte to register
function configureSensor(): boolean {
  // Write 0x27 to CTRL_MEAS register (0xF4)
  const result = I2C0.device(BME280_ADDR).write(0x27).to(0xF4);
  
  if (result.ok) {
    UART0.println("Sensor configured");
    return true;
  } else {
    switch (result.status) {
      case I2CStatus.DATA_TOO_LONG:
        UART0.println("Error: Data too long");
        break;
      case I2CStatus.NACK_ON_ADDRESS:
        UART0.println("Error: NACK on address");
        break;
      case I2CStatus.NACK_ON_DATA:
        UART0.println("Error: NACK on data");
        break;
      case I2CStatus.OTHER_ERROR:
        UART0.println("Error: Other I2C error");
        break;
    }
    return false;
  }
}

// Fluent write: write multiple bytes
function writeMultipleBytes(): boolean {
  // Write array of bytes to a register
  const data = new Uint8Array([0x01, 0x02, 0x03]);
  const result = I2C0.device(BME280_ADDR).write(data).to(0x88);
  
  return result.ok;
}

// Configure sensor at startup
if (configureSensor()) {
  UART0.println("Sensor configuration complete");
}

// Main loop
while (true) {
  // Write a single register value
  const result = I2C0.device(BME280_ADDR).write(0x00).to(0xF5);
  
  if (!result.ok) {
    UART0.println("Configuration write failed");
  }
  
  delay(5000);
}
