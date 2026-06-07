// ---------------------------------------------------------------------------
// Example 5d — I2C Bus Scan
//
// Scans the I2C bus for connected devices.
// Shows: Checking device presence, iterating through addresses, standard I2C address ranges
// ---------------------------------------------------------------------------

import { I2C0, UART0, delay } from '@typecad';

// Initialize UART0 for debug output
const serial = UART0.begin(9600);

// Initialize I2C as master
const sensor = I2C0.begin();

// Check if a device responds at the given address
function devicePresent(addr: number): boolean {
  // Try to read 1 byte from register 0 to check presence
  // This is a common I2C device detection technique
  try {
    const data = sensor.device(addr).readBytes(0, 1);
    return data.length > 0;
  } catch {
    return false;
  }
}

// Scan a range of addresses and report found devices
function scanBus(): number {
  let devicesFound = 0;
  
  serial.println("Scanning I2C bus...");
  serial.println("     0  1  2  3  4  5  6  7  8  9  A  B  C  D  E  F");
  
  // Scan addresses 0x08 to 0x77 (valid 7-bit address range)
  // 0x00-0x07 and 0x78-0x7F are reserved
  for (let row = 0; row < 8; row++) {
    // Print row header (high nibble)
    serial.print(`${row.toString(16).toUpperCase()}0: `);
    
    for (let col = 0; col < 16; col++) {
      const addr = row * 16 + col;
      
      // Skip reserved addresses
      if (addr < 0x08 || addr > 0x77) {
        serial.print("   ");
        continue;
      }
      
      if (devicePresent(addr)) {
        serial.print(`${addr.toString(16).toUpperCase().padStart(2, '0')} `);
        devicesFound++;
      } else {
        serial.print("-- ");
      }
    }
    serial.println("");
  }
  
  return devicesFound;
}

// Quick scan - just list found devices
function quickScan(): number[] {
  const found: number[] = [];
  
  for (let addr = 0x08; addr <= 0x77; addr++) {
    if (devicePresent(addr)) {
      found.push(addr);
    }
  }
  
  return found;
}

// Initial scan at startup
serial.println("=== I2C Bus Scan ===");
const count = scanBus();
serial.println(`Found ${count} device(s)`);

// Print known device addresses
serial.println("\nCommon I2C addresses:");
serial.println("0x3C-0x3D: OLED displays (SSD1306)");
serial.println("0x68: RTC (DS3231), IMU (MPU-6050)");
serial.println("0x76-0x77: BME280/BMP280");
serial.println("0x48-0x4F: I/O expanders, ADCs");

// Periodic quick scan
while (true) {
  delay(10000);
  
  const devices = quickScan();
  if (devices.length > 0) {
    serial.print("Devices at: ");
    for (const addr of devices) {
      serial.print(`0x${addr.toString(16).toUpperCase()} `);
    }
    serial.println("");
  } else {
    serial.println("No I2C devices found");
  }
}
