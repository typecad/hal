// ---------------------------------------------------------------------------
// Example 6 — SPI Basic
//
// Demonstrates basic SPI communication using Arduino-compatible API.
// Shows: begin(), transfer(), setMode(), setBitOrder(), setFrequency()
// ---------------------------------------------------------------------------

import { SPI0, UART0, delay, D10 } from '@typecode';

UART0.config.baudRate(9600).begin();

// Initialize SPI with configuration
SPI0.config.frequency(1_000_000)
          .mode(0)
          .bitOrder('msb')
          .begin();

// Chip select pin
const CS = D10;
CS.config.output.initial(true);  // Initialize as output, HIGH (deselected)

UART0.println("SPI Basic Example");

while (true) {
  // Select device
  // CS.low();    // not needed with fluent api
  
  // Send byte and receive response (full-duplex)
  const response = SPI0.device(CS).transfer(0x44);
  // Deselect device
  // CS.high();// not needed with fluent api
  
  UART0.write.line(`Sent: 0xAA, Received: 0x${response}`);
  
  delay(1000);
  
  // Transfer multiple bytes
  SPI0.device(CS).transfer(new Uint8Array([0x80, 0x00, 0xFF]));
    
  delay(1000);
}
