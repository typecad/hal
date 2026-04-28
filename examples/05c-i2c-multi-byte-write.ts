// ---------------------------------------------------------------------------
// Example 5c — I2C Multi-Byte Write
//
// Demonstrates writing multiple bytes to configure a device.
// Shows: Writing register address + multiple data bytes in one transaction,
//        writing arrays
// ---------------------------------------------------------------------------

import { I2C0, UART0, delay } from '@typehal';

// Initialize UART0 for debug output
const serial = UART0.begin(9600);

// Initialize I2C as master with 400kHz clock
const sensor = I2C0.begin();
sensor.setClock(400000);

const BME280_ADDR = 0x76;

// Write multiple configuration bytes to device
function configureSensor(): void {
  // Write configuration bytes to register 0xF5
  sensor.device(BME280_ADDR).writeBytes(0xF5, [0b10100000, 0b00100111]);
}

// Write a buffer/array of data
function writeBuffer(register: number, data: Uint8Array): void {
  sensor.device(BME280_ADDR).writeBytes(register, data);
}

// Alternative: Track bytes written
function writeWithTracking(register: number, values: number[]): number {
  sensor.device(BME280_ADDR).writeBytes(register, values);
  return values.length + 1; // +1 for register address
}

// Configure sensor at startup
configureSensor();
serial.println("Sensor configured");

// Example: Write calibration data using buffer
const calibData = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
writeBuffer(0x88, calibData);
serial.println("Calibration data written");

// Main loop
while (true) {
  // Write a single register
  sensor.device(BME280_ADDR).writeByte(0xF4, 0x27); // CTRL_MEAS
  serial.println("Register written");
  
  delay(5000);
}
