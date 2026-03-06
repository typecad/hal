// ---------------------------------------------------------------------------
// Example 5b — I2C Error Handling
//
// Demonstrates proper error handling for I2C operations.
// Shows: I2CStatus enum, checking endTransmission() status,
//        handling partial reads with requestFrom()
// ---------------------------------------------------------------------------

import { I2C0, Serial } from '@typecode/board-arduino-uno';
import { I2CStatus }    from '@typecode/core';
import { delay }        from '@typecode/board-arduino-uno';

Serial.initialize({ baudRate: 9600 });
I2C0.begin();
I2C0.setClock(100000);  // Standard 100kHz mode

const SENSOR_ADDR = 0x76;

function readSensor(): number | null {
  // Set register pointer
  I2C0.beginTransmission(SENSOR_ADDR);
  I2C0.write(0xFA);
  
  // Check transmission status
  const status = I2C0.endTransmission();
  
  switch (status) {
    case I2CStatus.SUCCESS:
      break;  // Continue with read
    case I2CStatus.DATA_TOO_LONG:
      Serial.println("Error: Transmit buffer overflow");
      return null;
    case I2CStatus.NACK_ON_ADDRESS:
      Serial.println("Error: Device not responding (NACK on address)");
      return null;
    case I2CStatus.NACK_ON_DATA:
      Serial.println("Error: Device rejected data (NACK on data)");
      return null;
    case I2CStatus.OTHER_ERROR:
      Serial.println("Error: Unknown I2C error");
      return null;
  }
  
  // Request 2 bytes
  const bytesReceived = I2C0.requestFrom(SENSOR_ADDR, 2);
  
  // Check if we got the expected number of bytes
  if (bytesReceived < 2) {
    Serial.println(`Warning: Only received ${bytesReceived} bytes (expected 2)`);
    
    // Read whatever is available
    if (bytesReceived === 0) {
      return null;
    }
  }
  
  // Read available bytes
  const msb = I2C0.read();
  const lsb = I2C0.available() > 0 ? I2C0.read() : 0;
  
  return (msb << 8) | lsb;
}

// Main loop with retry logic
let consecutiveErrors = 0;
const MAX_ERRORS = 5;

while (true) {
  const value = readSensor();
  
  if (value !== null) {
    consecutiveErrors = 0;
    const temperature = value / 100.0;
    Serial.println(`Temperature: ${temperature}°C`);
  } else {
    consecutiveErrors++;
    if (consecutiveErrors >= MAX_ERRORS) {
      Serial.println("Max errors reached, attempting bus recovery...");
      if (I2C0.recover()) {
        Serial.println("Bus recovery successful");
        consecutiveErrors = 0;
      } else {
        Serial.println("Bus recovery failed");
      }
    }
  }
  
  delay(1000);
}