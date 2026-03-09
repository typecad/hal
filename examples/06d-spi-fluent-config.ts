// ---------------------------------------------------------------------------
// Example 6d — SPI Fluent Configuration (Experimental)
//
// Demonstrates the fluent chainable configuration API for SPI.
// Shows: SPI0.config.frequency().mode().bitOrder().begin()
//
// NOTE: This API is type-safe but requires transpiler support.
// ---------------------------------------------------------------------------

import { SPI0, UART0, D10 } from '@typecode';
import { delay } from '@typecode';

UART0.config.baudRate(9600).begin();

// Fluent configuration - chain methods to set up SPI
SPI0.config
  .frequency(2_000_000)    // 2 MHz clock
  .mode(0)                  // SPI mode 0
  .bitOrder('msb')          // MSB first
  .begin();                 // Initialize

UART0.println("SPI initialized with fluent API");

// Chip select
const CS = D10;
CS.config.output.initial(true);  // Initialize as output, HIGH (deselected)

while (true) {
  // Use fluent API for transfer
  const response = SPI0.device(CS).transfer(0xFF);
  
  UART0.write.line(`Response: 0x${response.toString()}`);
  delay(1000);
}
