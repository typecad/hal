// ---------------------------------------------------------------------------
// Example 5d — I2C Bus Scan
//
// Scans the I2C bus for connected devices.
// Shows: Checking device presence with endTransmission(),
//        iterating through addresses, standard I2C address ranges
// ---------------------------------------------------------------------------

import { I2C0, UART0 } from '@typecode/board-arduino-uno/arduino';
import { delay }        from '@typecode/board-arduino-uno';

UART0.begin(9600);
I2C0.begin();

// Check if a device responds at the given address
function devicePresent(addr: number): boolean {
  I2C0.beginTransmission(addr);
  const status = I2C0.endTransmission();
  return status === 0;
}

// Scan a range of addresses and report found devices
function scanBus(): number {
  let devicesFound = 0;
  
  UART0.println("Scanning I2C bus...");
  UART0.println("     0  1  2  3  4  5  6  7  8  9  A  B  C  D  E  F");
  
  // Scan addresses 0x08 to 0x77 (valid 7-bit address range)
  // 0x00-0x07 and 0x78-0x7F are reserved
  for (let row = 0; row < 8; row++) {
    // Print row header (high nibble)
    UART0.print(`${row.toString(16).toUpperCase()}0: `);
    
    for (let col = 0; col < 16; col++) {
      const addr = row * 16 + col;
      
      // Skip reserved addresses
      if (addr < 0x08 || addr > 0x77) {
        UART0.print("   ");
        continue;
      }
      
      if (devicePresent(addr)) {
        UART0.print(`${addr.toString(16).toUpperCase().padStart(2, '0')} `);
        devicesFound++;
      } else {
        UART0.print("-- ");
      }
    }
    UART0.println("");
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
UART0.println("=== I2C Bus Scan ===");
const count = scanBus();
UART0.println(`Found ${count} device(s)`);

// Print known device addresses
UART0.println("\nCommon I2C addresses:");
UART0.println("0x3C-0x3D: OLED displays (SSD1306)");
UART0.println("0x68: RTC (DS3231), IMU (MPU-6050)");
UART0.println("0x76-0x77: BME280/BMP280");
UART0.println("0x48-0x4F: I/O expanders, ADCs");

// Periodic quick scan
while (true) {
  delay(10000);
  
  const devices = quickScan();
  if (devices.length > 0) {
    UART0.print("Devices at: ");
    for (const addr of devices) {
      UART0.print(`0x${addr.toString(16).toUpperCase()} `);
    }
    UART0.println("");
  } else {
    UART0.println("No I2C devices found");
  }
}
