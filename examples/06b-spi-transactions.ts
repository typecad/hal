// ---------------------------------------------------------------------------
// Example 6b — SPI Transactions
//
// Demonstrates SPI transactions for time-critical communication.
// Shows: Reconfiguring SPI between devices with different settings
// ---------------------------------------------------------------------------

import { SPI0, UART0, D10, delay } from '@typecode';

UART0.config.baudRate(9600).begin();

// Chip select pin
const CS = D10;
CS.config.output.initial(true);  // Initialize as output, HIGH (deselected)

// Initialize SPI with default settings
SPI0.config.frequency(1_000_000)
          .mode(0)
          .bitOrder('msb')
          .begin();

UART0.println("SPI Transactions Example");

while (true) {
  // Transaction 1: Fast device (4 MHz, mode 0, MSB)
  SPI0.config.frequency(4_000_000)
            .mode(0)
            .bitOrder('msb');
  
  const response1 = SPI0.device(CS).transfer(0x55);
  
  UART0.println(`Fast device: 0x${response1.toString()}`);
  
  delay(100);
  
  // Transaction 2: Slow device (500 kHz, mode 2, LSB)
  SPI0.config.frequency(500_000)
            .mode(2)
            .bitOrder('lsb');
  
  const response2 = SPI0.device(CS).transfer(0xAA);
  
  UART0.println(`Slow device: 0x${response2.toString()}`);
  
  delay(1000);
}