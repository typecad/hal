// ---------------------------------------------------------------------------
// Example 6c — SPI Shift Register (74HC595)
//
// Demonstrates using SPI to control a shift register for LED patterns.
// Shows: write(), transferBuffer(), simple data output
// ---------------------------------------------------------------------------

import { SPI0, UART0 } from '@typecode/board-arduino-uno/arduino';
import { D10, delay } from '@typecode/board-arduino-uno';

UART0.begin(9600);

// Chip select (latch pin on 74HC595)
const LATCH = D10;
LATCH.asOutput();
LATCH.high();

// Initialize SPI
SPI0.begin();
SPI0.setMode(0);
SPI0.setBitOrder('msb');
SPI0.setFrequency(2_000_000);

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

let patternIndex = 0;

// Knight Rider style scanning
while (true) {
  // Scan left
  for (let i = 0; i < 8; i++) {
    shiftOut(patterns[i]);
    delay(100);
  }
  
  // Scan right
  for (let i = 6; i > 0; i--) {
    shiftOut(patterns[i]);
    delay(100);
  }
}

function shiftOut(data: number): void {
  // Latch low to start
  LATCH.low();
  
  // Shift data out
  SPI0.transfer(data);
  
  // Latch high to update outputs
  LATCH.high();
}

// Alternative: Shift out multiple bytes for daisy-chained registers
function shiftOutMultiple(data: Uint8Array): void {
  LATCH.low();
  
  // Send all bytes (first byte goes to last register in chain)
  SPI0.transferBuffer(data);
  
  LATCH.high();
}
