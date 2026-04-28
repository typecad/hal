// ---------------------------------------------------------------------------
// Example 6c — SPI Shift Register (74HC595)
//
// Demonstrates using SPI to control a shift register for LED patterns.
// Shows: write(), transfer() with Uint8Array, simple data output
// ---------------------------------------------------------------------------

import { SPI0, UART0, D10, delay } from '@typehal';

const serial = UART0.begin(9600);

// Chip select (latch pin on 74HC595)
const LATCH = D10;
LATCH.asOutput(true);  // true (data not latched)

// Initialize SPI with configuration
const spi = SPI0.begin();
spi.setFrequency(2_000_000);
spi.setMode(0);
spi.setBitOrder('msb');

serial.println("74HC595 Shift Register Demo");

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
    spi.device(LATCH).write(patterns[i]);
    delay(100);
  }
  
  // Scan right
  for (let i = 6; i > 0; i--) {
    spi.device(LATCH).write(patterns[i]);
    delay(100);
  }
}

// Alternative: Shift out multiple bytes for daisy-chained registers
function shiftOutMultiple(data: Uint8Array): void {
  // Send all bytes (first byte goes to last register in chain)
  spi.device(LATCH).transfer(data);
}
