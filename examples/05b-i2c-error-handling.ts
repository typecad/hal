// ---------------------------------------------------------------------------
// Example 5b — I2C Error Handling
//
// Demonstrates proper error handling for I2C operations.
// Shows: I2CStatus enum, fluent API error handling, bus recovery
// ---------------------------------------------------------------------------

import { I2C0, UART0, delay } from '@typecode';
import { I2CStatus } from '@typecode/core';

// Initialize UART0 for debug output
UART0.config.baudRate(9600).begin();

// Initialize I2C as master with 100kHz clock
I2C0.config.speed(100000).begin();

const SENSOR_ADDR = 0x76;

function readSensor(): number | null {
  // Read 2 bytes from register 0xFA with error handling
  const result = I2C0.device(SENSOR_ADDR).read(2).from(0xFA);
  
  if (!result.ok) {
    switch (result.status) {
      case I2CStatus.DATA_TOO_LONG:
        UART0.println("Error: Transmit buffer overflow");
        break;
      case I2CStatus.NACK_ON_ADDRESS:
        UART0.println("Error: Device not responding (NACK on address)");
        break;
      case I2CStatus.NACK_ON_DATA:
        UART0.println("Error: Device rejected data (NACK on data)");
        break;
      case I2CStatus.OTHER_ERROR:
        UART0.println("Error: Unknown I2C error");
        break;
      case I2CStatus.PARTIAL_READ:
        UART0.println(`Warning: Only received ${result.bytesRead} bytes (expected 2)`);
        break;
    }
    return null;
  }
  
  // Combine into raw temperature value
  const tempRaw = (result.value[0] << 8) | result.value[1];
  return tempRaw;
}

// Main loop with retry logic
let consecutiveErrors = 0;
const MAX_ERRORS = 5;

while (true) {
  const value = readSensor();
  
  if (value !== null) {
    consecutiveErrors = 0;
    const temperature = value / 100.0;
    UART0.println(`Temperature: ${temperature}°C`);
  } else {
    consecutiveErrors++;
    if (consecutiveErrors >= MAX_ERRORS) {
      UART0.println("Max errors reached, attempting bus recovery...");
      if (I2C0.recover()) {
        UART0.println("Bus recovery successful");
        consecutiveErrors = 0;
      } else {
        UART0.println("Bus recovery failed");
      }
    }
  }
  
  delay(1000);
}