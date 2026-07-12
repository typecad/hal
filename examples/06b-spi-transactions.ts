// ---------------------------------------------------------------------------
// Example 6b — SPI Transactions
//
// Demonstrates SPI transactions for time-critical communication.
// Shows: Reconfiguring SPI between devices with different settings
// ---------------------------------------------------------------------------

import { SPI0, UART0, D10, delay } from '@typecad/board';

const serial = UART0.begin(9600);

// Chip select pin
const CS = D10;
CS.asOutput(true);  // true (deselected)

// Initialize SPI with default settings
const spi = SPI0.begin();
spi.setFrequency(1_000_000);
spi.setMode(0);
spi.setBitOrder('msb');

serial.println("SPI Transactions Example");

while (true) {
  // Transaction 1: Fast device (4 MHz, mode 0, MSB)
  spi.setFrequency(4_000_000);
  spi.setMode(0);
  spi.setBitOrder('msb');
  
  const response1 = spi.device(CS).transfer(0x55);
  
  serial.println(`Fast device: 0x${response1.toString()}`);
  
  delay(100);
  
  // Transaction 2: Slow device (500 kHz, mode 2, LSB)
  spi.setFrequency(500_000);
  spi.setMode(2);
  spi.setBitOrder('lsb');
  
  const response2 = spi.device(CS).transfer(0xAA);
  
  serial.println(`Slow device: 0x${response2.toString()}`);
  
  delay(1000);
}
