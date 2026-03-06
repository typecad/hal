// ---------------------------------------------------------------------------
// Example 6b — SPI Transactions
//
// Demonstrates SPI transactions for time-critical communication.
// Shows: beginTransaction(), endTransaction(), SPISettings
// ---------------------------------------------------------------------------

import { SPI0, UART0 } from '@typecode/board-arduino-uno/arduino';
import { D10 } from '@typecode/board-arduino-uno';
import { delay } from '@typecode/board-arduino-uno';

UART0.begin(9600);

// Chip select pin
const CS = D10;
CS.asOutput();
CS.high();

// Initialize SPI
SPI0.begin();

UART0.println("SPI Transactions Example");

// Define settings for different devices
const fastSettings = { frequency: 4_000_000, mode: 0, bitOrder: 'msb' as const };
const slowSettings = { frequency: 500_000, mode: 2, bitOrder: 'lsb' as const };

while (true) {
  // Transaction 1: Fast device
  SPI0.beginTransaction(fastSettings);
  CS.low();
  
  const response1 = SPI0.transfer(0x55);
  
  CS.high();
  SPI0.endTransaction();
  
  UART0.println(`Fast device: 0x${response1.toString(16)}`);
  
  delay(100);
  
  // Transaction 2: Slow device (different settings)
  SPI0.beginTransaction(slowSettings);
  CS.low();
  
  const response2 = SPI0.transfer(0xAA);
  
  CS.high();
  SPI0.endTransaction();
  
  UART0.println(`Slow device: 0x${response2.toString(16)}`);
  
  delay(1000);
}
