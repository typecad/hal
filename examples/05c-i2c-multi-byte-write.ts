// ---------------------------------------------------------------------------
// Example 5c — I2C Multi-Byte Write
//
// Demonstrates writing multiple bytes to configure a device.
// Shows: Writing register address + multiple data bytes in one transaction,
//        writing arrays
// ---------------------------------------------------------------------------

import { I2C0, UART0, delay } from '@typecode';

// Initialize UART0 for debug output
UART0.config.baudRate(9600).begin();

// Initialize I2C as master with 400kHz clock
I2C0.config.speed(400000).begin();

const BME280_ADDR = 0x76;

// Write multiple configuration bytes to device
function configureSensor(): boolean {
  // Write configuration bytes to register 0xF5
  const result = I2C0.device(BME280_ADDR).write([0b10100000, 0b00100111]).to(0xF5);
  return result.ok;
}

// Write a buffer/array of data
function writeBuffer(register: number, data: Uint8Array): boolean {
  const result = I2C0.device(BME280_ADDR).write(data).to(register);
  return result.ok;
}

// Alternative: Track bytes written (not directly supported by fluent API, but can check result)
function writeWithTracking(register: number, values: number[]): number {
  const result = I2C0.device(BME280_ADDR).write(values).to(register);
  
  // Return -1 on error, otherwise total bytes written
  return result.ok ? values.length + 1 : -1; // +1 for register address
}

// Configure sensor at startup
if (configureSensor()) {
  UART0.println("Sensor configured successfully");
} else {
  UART0.println("Sensor configuration failed");
}

// Example: Write calibration data using buffer
const calibData = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
if (writeBuffer(0x88, calibData)) {
  UART0.println("Calibration data written");
}

// Main loop
while (true) {
  // Write a single register
  const result = I2C0.device(BME280_ADDR).write(0x27).to(0xF4); // CTRL_MEAS
  
  if (result.ok) {
    UART0.println("Register written");
  }
  
  delay(5000);
}
