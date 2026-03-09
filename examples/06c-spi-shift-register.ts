// ---------------------------------------------------------------------------
// Example 6c — SPI Shift Register (74HC595)
//
// Demonstrates using SPI to control a shift register for LED patterns.
// Shows: write(), transfer() with Uint8Array, simple data output
// ---------------------------------------------------------------------------

import { SPI0, UART0, D10, delay } from '@typecode';

UART0.config.baudRate(9600).begin();

// Chip select (latch pin on 74HC595)
const LATCH = D10;
LATCH.config.output.initial(true);  // Initialize as output, HIGH (data not latched)

// Initialize SPI with configuration
SPI0.config.frequency(2_000_000)
          .mode(0)
          .bitOrder('msb')
          .begin();

UART0.println("74HC595 Shift Register Demo");

// Patterns for 8 LEDs
const patterns = [
  0b00000001,
  0b00000010,
  0b00000100,
  0b00001000,
  0b00010000,
  0b00100000,
  0b01000000,
  0b10000000,
];

// Knight Rider style scanning
while (true) {
  // Scan left
  for (let i = 0; i < 8; i++) {
    SPI0.device(LATCH).write(patterns[i]);
    delay(100);
  }
  
  // Scan right
  for (let i = 6; i > 0; i--) {
    SPI0.device(LATCH).write(patterns[i]);
    delay(100);
  }
}

// Alternative: Shift out multiple bytes for daisy-chained registers
function shiftOutMultiple(data: Uint8Array): void {
  // Send all bytes (first byte goes to last register in chain)
  SPI0.device(LATCH).transfer(data);
}