// ---------------------------------------------------------------------------
// Example 5b — I2C Error Handling
//
// Demonstrates proper error handling for I2C operations.
// Shows: Device accessor API, error checking patterns, bus recovery
// ---------------------------------------------------------------------------

import { I2C0, UART0, delay } from '@typehal';

// Initialize UART0 for debug output
const serial = UART0.begin(9600);

// Initialize I2C as master with 100kHz clock
const sensor = I2C0.begin();
sensor.setClock(100000);

const SENSOR_ADDR = 0x76;

function readSensor(): number | null {
  try {
    // Read 2 bytes from register 0xFA (temperature data)
    const data = sensor.device(SENSOR_ADDR).readBytes(0xFA, 2);

    if (data.length < 2) {
      serial.println(`Warning: Only received ${data.length} bytes (expected 2)`);
      return null;
    }

    // Combine into raw temperature value
    const tempRaw = (data[0] << 8) | data[1];
    return tempRaw;
  } catch {
    serial.println("Error: I2C communication failed");
    return null;
  }
}

// Main loop with retry logic
let consecutiveErrors = 0;
const MAX_ERRORS = 5;

while (true) {
  const value = readSensor();
  
  if (value !== null) {
    consecutiveErrors = 0;
    const temperature = value / 100.0;
    serial.println(`Temperature: ${temperature}°C`);
  } else {
    consecutiveErrors++;
    if (consecutiveErrors >= MAX_ERRORS) {
      serial.println("Max errors reached, attempting bus recovery...");
      if (sensor.recover()) {
        serial.println("Bus recovery successful");
        consecutiveErrors = 0;
      } else {
        serial.println("Bus recovery failed");
      }
    }
  }
  
  delay(1000);
}
