// ---------------------------------------------------------------------------
// Example 5c — I2C Multi-Byte Write
//
// Demonstrates writing multiple bytes to configure a device.
// Shows: Writing register address + multiple data bytes in one transaction,
//        writing arrays, write() returns byte count
// ---------------------------------------------------------------------------

import { I2C0, Serial } from '@typecode/board-arduino-uno';
import { delay }        from '@typecode/board-arduino-uno';

Serial.initialize({ baudRate: 9600 });
I2C0.begin();
I2C0.setClock(400000);

const BME280_ADDR = 0x76;

// Write multiple configuration bytes to device
function configureSensor(): boolean {
  I2C0.beginTransmission(BME280_ADDR);
  
  // Write register address first (0xF5 = CONFIG)
  I2C0.write(0xF5);
  
  // Write configuration bytes
  I2C0.write(0b10100000);  // t_sb=101 (1000ms), filter=000 (off)
  I2C0.write(0b00100111);  // spi3w_en=0, ovrsmpl=001 (1x)
  
  const status = I2C0.endTransmission();
  return status === 0;
}

// Write a buffer/array of data
function writeBuffer(register: number, data: Uint8Array): boolean {
  I2C0.beginTransmission(BME280_ADDR);
  I2C0.write(register);
  
  // Write all bytes from buffer
  for (let i = 0; i < data.length; i++) {
    I2C0.write(data[i]);
  }
  
  const status = I2C0.endTransmission();
  return status === 0;
}

// Alternative: Track bytes written
function writeWithTracking(register: number, values: number[]): number {
  I2C0.beginTransmission(BME280_ADDR);
  
  let totalWritten = 0;
  totalWritten += I2C0.write(register);
  
  for (const value of values) {
    totalWritten += I2C0.write(value);
  }
  
  const status = I2C0.endTransmission();
  
  // Return -1 on error, otherwise total bytes written
  return status === 0 ? totalWritten : -1;
}

// Configure sensor at startup
if (configureSensor()) {
  Serial.println("Sensor configured successfully");
} else {
  Serial.println("Sensor configuration failed");
}

// Example: Write calibration data using buffer
const calibData = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
if (writeBuffer(0x88, calibData)) {
  Serial.println("Calibration data written");
}

// Main loop
while (true) {
  // Write a single register
  I2C0.beginTransmission(BME280_ADDR);
  I2C0.write(0xF4);  // CTRL_MEAS register
  I2C0.write(0x27);  // Normal mode, pressure/temperature oversampling x1
  const status = I2C0.endTransmission();
  
  if (status === 0) {
    Serial.println("Register written");
  }
  
  delay(5000);
}