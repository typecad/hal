/**
 * I2C Register Shortcuts Example
 * 
 * Demonstrates the convenient register shortcut methods on I2C devices:
 * - readByte(register) - Read a single byte from a register
 * - readBytes(register, count) - Read multiple bytes from a register
 * - writeByte(register, value) - Write a single byte to a register
 * - writeBytes(register, data) - Write multiple bytes to a register
 * 
 * Example uses a BME280 sensor (address 0x76 or 0x77).
 */

import { I2C0, delay, UART0 } from '@typecode';

// BME280 I2C address (try 0x77 if 0x76 doesn't work)
const BME280_ADDR = 0x76;

// BME280 register addresses
const BME280_REG_ID = 0xD0;
const BME280_REG_CTRL_MEAS = 0xF4;
const BME280_REG_TEMP_MSB = 0xFA;

// Initialize serial and I2C
UART0.config.baudRate(9600).begin();
I2C0.config.begin();

// Enable debug output for I2C errors
I2C0.debugOnError = true;

// Read device ID to verify connection
const device = I2C0.device(BME280_ADDR);
const chipId = device.readByte(BME280_REG_ID);

UART0.print("BME280 Chip ID: 0x");
UART0.println(chipId.toString(16));

if (chipId !== 0x58) {
  UART0.println("BME280 not found! Check wiring and address.");
}

// Configure sensor for normal mode
device.writeByte(BME280_REG_CTRL_MEAS, 0x27);

UART0.println("Starting temperature readings...");
UART0.println("-------------------");

while (true) {
  // Read 3 bytes of temperature data using the shortcut
  const tempData = device.readBytes(BME280_REG_TEMP_MSB, 3);
  
  // Convert raw bytes to temperature (simplified)
  const rawTemp = (tempData[0] << 12) | (tempData[1] << 4) | (tempData[2] >> 4);
  
  // Approximate Celsius (full compensation requires calibration data)
  const tempC = rawTemp / 5120.0;
  
  UART0.print("Temperature: ");
  UART0.print(tempC);
  UART0.println(" C");
  
  delay(1000);
}