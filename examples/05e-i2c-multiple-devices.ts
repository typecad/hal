// ---------------------------------------------------------------------------
// Example 5e — I2C Multiple Devices
//
// Demonstrates communicating with multiple I2C devices on the same bus.
// Shows: Different device addresses, mixing reads and writes,
//        device abstraction patterns
// ---------------------------------------------------------------------------

import { I2C0, UART0, delay } from '@typecode';

// Initialize UART0 for debug output
UART0.config.baudRate(9600).begin();

// Initialize I2C as master with 400kHz clock
I2C0.config.speed(400000).begin();

// Device addresses
const OLED_ADDR = 0x3C;
const BME280_ADDR = 0x76;
const MPU6050_ADDR = 0x68;
const EEPROM_ADDR = 0x50;

// Simple device abstraction using fluent API
interface I2CDevice {
  address: number;
  writeRegister(reg: number, value: number): boolean;
  readRegister(reg: number): number | null;
}

function createDevice(addr: number): I2CDevice {
  return {
    address: addr,
    writeRegister(reg: number, value: number): boolean {
      const result = I2C0.device(addr).write(value).to(reg);
      return result.ok;
    },
    readRegister(reg: number): number | null {
      const result = I2C0.device(addr).read(1).from(reg);
      return result.ok ? result.value[0] : null;
    }
  };
}

// Create device instances
const bme280 = createDevice(BME280_ADDR);
const mpu6050 = createDevice(MPU6050_ADDR);

// Read 16-bit value from two consecutive registers
function readUint16BE(device: I2CDevice, reg: number): number | null {
  const result = I2C0.device(device.address).read(2).from(reg);
  if (result.ok && result.value.length >= 2) {
    return (result.value[0] << 8) | result.value[1];
  }
  return null;
}

// Initialize MPU-6050
function initMPU6050(): boolean {
  const result1 = I2C0.device(MPU6050_ADDR).write(0x00).to(0x6B); // Wake up
  if (!result1.ok) return false;
  
  const result2 = I2C0.device(MPU6050_ADDR).write(0x07).to(0x19); // Sample rate divider
  return result2.ok;
}

// Read accelerometer data from MPU-6050
function readAccel(): { x: number; y: number; z: number } | null {
  // Accelerometer registers start at 0x3B (X_HIGH)
  const result = I2C0.device(MPU6050_ADDR).read(6).from(0x3B);
  if (result.ok && result.value.length >= 6) {
    const x = (result.value[0] << 8) | result.value[1];
    const y = (result.value[2] << 8) | result.value[3];
    const z = (result.value[4] << 8) | result.value[5];
    return { x, y, z };
  }
  return null;
}

// Initialize devices
if (initMPU6050()) {
  UART0.println("MPU-6050 initialized");
} else {
  UART0.println("MPU-6050 not found");
}

// Main loop - read from multiple devices
while (true) {
  // Read temperature from BME280
  const tempResult = I2C0.device(BME280_ADDR).read(2).from(0xFA);
  if (tempResult.ok && tempResult.value.length >= 2) {
    const tempRaw = (tempResult.value[0] << 8) | tempResult.value[1];
    UART0.print("Temp: ");
    UART0.print(tempRaw / 100.0);
    UART0.print("C  ");
  }
  
  // Read accelerometer from MPU-6050
  const accel = readAccel();
  if (accel) {
    UART0.print(`Accel: X=${accel.x} Y=${accel.y} Z=${accel.z}`);
  }
  
  UART0.println("");
  delay(1000);
}
