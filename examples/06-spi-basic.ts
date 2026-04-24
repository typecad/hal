// ---------------------------------------------------------------------------
// Example 6 — SPI Basic
//
// Demonstrates basic SPI communication using Arduino-compatible API.
// Shows: begin(), transfer(), setMode(), setBitOrder(), setFrequency()
// ---------------------------------------------------------------------------

import { SPI0, UART0, delay, D10 } from '@typecode';

const serial = UART0.begin(9600);

// Initialize SPI with configuration
const spi = SPI0.begin();
spi.setFrequency(1_000_000);
spi.setMode(0);
spi.setBitOrder('msb');

// Chip select pin
const CS = D10;
CS.asOutput(true);  // true (deselected)

serial.println("SPI Basic Example");

while (true) {
  // Send byte and receive response (full-duplex)
  // CS is asserted and deasserted automatically by .device()
  const response = spi.device(CS).transfer(0x44);

  serial.println(`Sent: 0xAA, Received: 0x${response}`);
  
  delay(1000);
  
  // Transfer multiple bytes
  spi.device(CS).transfer(new Uint8Array([0x80, 0x00, 0xFF]));
    
  delay(1000);
}
