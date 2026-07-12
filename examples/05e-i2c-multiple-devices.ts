// ---------------------------------------------------------------------------
// Example 5e — I2C Multiple Devices
//
// Demonstrates communicating with multiple I2C devices on the same bus.
// Shows: Different device addresses, mixing reads and writes,
//        device abstraction patterns
// ---------------------------------------------------------------------------

import { I2C0, UART0, delay } from '@typecad/board';

// Initialize UART0 for debug output
const serial = UART0.begin(9600);

// Initialize I2C as master with 400kHz clock
const sensor = I2C0.begin();
sensor.setClock(400000);

// Device addresses
const OLED_ADDR = 0x3C;
const BME280_ADDR = 0x76;
const MPU6050_ADDR = 0x68;
const EEPROM_ADDR = 0x50;

// Simple device abstraction
interface I2CDevice {
  address: number;
  writeRegister(reg: number, value: number): void;
  readRegister(reg: number): number | null;
}

function createDevice(addr: number): I2CDevice {
  return {
    address: addr,
    writeRegister(reg: number, value: number): void {
      sensor.device(addr).writeByte(reg, value);
    },
    readRegister(reg: number): number | null {
      try {
        const data = sensor.device(addr).readBytes(reg, 1);
        return data.length > 0 ? data[0] : null;
      } catch {
        return null;
      }
    }
  };
}

// Create device instances
const bme280 = createDevice(BME280_ADDR);
const mpu6050 = createDevice(MPU6050_ADDR);

// Read 16-bit value from two consecutive registers
function readUint16BE(device: I2CDevice, reg: number): number | null {
  try {
    const data = sensor.device(device.address).readBytes(reg, 2);
    if (data.length >= 2) {
      return (data[0] << 8) | data[1];
    }
    return null;
  } catch {
    return null;
  }
}

// Initialize MPU-6050
function initMPU6050(): void {
  sensor.device(MPU6050_ADDR).writeByte(0x6B, 0x00); // Wake up
  sensor.device(MPU6050_ADDR).writeByte(0x19, 0x07); // Sample rate divider
}

// Read accelerometer data from MPU-6050
function readAccel(): { x: number; y: number; z: number } | null {
  // Accelerometer registers start at 0x3B (X_HIGH)
  try {
    const data = sensor.device(MPU6050_ADDR).readBytes(0x3B, 6);
    if (data.length >= 6) {
      const x = (data[0] << 8) | data[1];
      const y = (data[2] << 8) | data[3];
      const z = (data[4] << 8) | data[5];
      return { x, y, z };
    }
    return null;
  } catch {
    return null;
  }
}

// Initialize devices
initMPU6050();
serial.println("MPU-6050 initialized");

// Main loop - read from multiple devices
while (true) {
  // Read temperature from BME280
  const tempData = sensor.device(BME280_ADDR).readBytes(0xFA, 2);
  if (tempData.length >= 2) {
    const tempRaw = (tempData[0] << 8) | tempData[1];
    serial.print("Temp: ");
    serial.print(tempRaw / 100.0);
    serial.print("C  ");
  }
  
  // Read accelerometer from MPU-6050
  const accel = readAccel();
  if (accel) {
    serial.print(`Accel: X=${accel.x} Y=${accel.y} Z=${accel.z}`);
  }
  
  serial.println("");
  delay(1000);
}
