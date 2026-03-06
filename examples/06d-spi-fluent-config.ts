// ---------------------------------------------------------------------------
// Example 6d — SPI Fluent Configuration (Experimental)
//
// Demonstrates the fluent chainable configuration API for SPI.
// Shows: SPI0.config.frequency().mode().bitOrder().begin()
//
// NOTE: This API is type-safe but requires transpiler support.
// ---------------------------------------------------------------------------

import { SPI0, UART0, D10 } from '@typecode/board-arduino-uno';
import { delay } from '@typecode/board-arduino-uno';

UART0.initialize({ baudRate: 9600 });

// Fluent configuration - chain methods to set up SPI
SPI0.config
  .frequency(2_000_000)    // 2 MHz clock
  .mode(0)                  // SPI mode 0
  .bitOrder('msb')          // MSB first
  .begin();                 // Initialize

UART0.println("SPI initialized with fluent API");

// Chip select
const CS = D10;
CS.asOutput();
CS.high();

while (true) {
  // Use Arduino-compatible API for transfers
  CS.low();
  const response = SPI0.transfer(0xFF);
  CS.high();
  
  UART0.println(`Response: 0x${response.toString(16)}`);
  delay(1000);
}
