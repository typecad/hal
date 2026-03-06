// ---------------------------------------------------------------------------
// Example 5e — I2C Multiple Devices
//
// Demonstrates communicating with multiple I2C devices on the same bus.
// Shows: Different device addresses, mixing reads and writes,
//        device abstraction patterns
// ---------------------------------------------------------------------------

import { I2C0, UART0 } from '@typecode/board-arduino-uno/arduino';
import { delay }        from '@typecode/board-arduino-uno';

UART0.begin(9600);
I2C0.begin();
I2C0.setClock(400000);

// Device addresses
const OLED_ADDR = 0x3C;
const BME280_ADDR = 0x76;
const MPU6050_ADDR = 0x68;
const EEPROM_ADDR = 0x50;

// Simple device abstraction
interface I2CDevice {
  address: number;
  writeRegister(reg: number, value: number): boolean;
  readRegister(reg: number): number | null;
}

function createDevice(addr: number): I2CDevice {
  return {
    address: addr,
    writeRegister(reg: number, value: number): boolean {
      I2C0.beginTransmission(this.address);
      I2C0.write(reg);
      I2C0.write(value);
      return I2C0.endTransmission() === 0;
    },
    readRegister(reg: number): number | null {
      I2C0.beginTransmission(this.address);
      I2C0.write(reg);
      if (I2C0.endTransmission() !== 0) return null;
      
      if (I2C0.requestFrom(this.address, 1) > 0) {
        return I2C0.read();
      }
      return null;
    }
  };
}

// Create device instances
const bme280 = createDevice(BME280_ADDR);
const mpu6050 = createDevice(MPU6050_ADDR);

// Read 16-bit value from two consecutive registers
function readUint16BE(device: I2CDevice, reg: number): number | null {
  I2C0.beginTransmission(device.address);
  I2C0.write(reg);
  if (I2C0.endTransmission() !== 0) return null;
  
  if (I2C0.requestFrom(device.address, 2) >= 2) {
    const msb = I2C0.read();
    const lsb = I2C0.read();
    return (msb << 8) | lsb;
  }
  return null;
}

// Initialize MPU-6050
function initMPU6050(): boolean {
  I2C0.beginTransmission(MPU6050_ADDR);
  I2C0.write(0x6B);  // PWR_MGMT_1 register
  I2C0.write(0x00);  // Wake up
  if (I2C0.endTransmission() !== 0) return false;
  
  I2C0.beginTransmission(MPU6050_ADDR);
  I2C0.write(0x19);  // SMPLRT_DIV
  I2C0.write(0x07);  // Sample rate divider
  return I2C0.endTransmission() === 0;
}

// Read accelerometer data from MPU-6050
function readAccel(): { x: number; y: number; z: number } | null {
  // Accelerometer registers start at 0x3B (X_HIGH)
  I2C0.beginTransmission(MPU6050_ADDR);
  I2C0.write(0x3B);
  if (I2C0.endTransmission() !== 0) return null;
  
  if (I2C0.requestFrom(MPU6050_ADDR, 6) >= 6) {
    const x = (I2C0.read() << 8) | I2C0.read();
    const y = (I2C0.read() << 8) | I2C0.read();
    const z = (I2C0.read() << 8) | I2C0.read();
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
  I2C0.beginTransmission(BME280_ADDR);
  I2C0.write(0xFA);  // Temperature MSB
  if (I2C0.endTransmission() === 0) {
    if (I2C0.requestFrom(BME280_ADDR, 2) >= 2) {
      const tempRaw = (I2C0.read() << 8) | I2C0.read();
      UART0.print("Temp: ");
      UART0.print(tempRaw / 100.0);
      UART0.print("C  ");
    }
  }
  
  // Read accelerometer from MPU-6050
  const accel = readAccel();
  if (accel) {
    UART0.print(`Accel: X=${accel.x} Y=${accel.y} Z=${accel.z}`);
  }
  
  UART0.println("");
  delay(1000);
}
