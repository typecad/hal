// ---------------------------------------------------------------------------
// Example 6 — SPI Basic
//
// Demonstrates basic SPI communication using Arduino-compatible API.
// Shows: begin(), transfer(), setMode(), setBitOrder(), setFrequency()
// ---------------------------------------------------------------------------

import { SPI0, Serial, D10 } from '@typecode/board-arduino-uno';
import { delay } from '@typecode/board-arduino-uno';

Serial.initialize({ baudRate: 9600 });

// Initialize SPI with default settings
SPI0.begin();

// Configure SPI settings
SPI0.setMode(0);           // SPI mode 0 (CPOL=0, CPHA=0)
SPI0.setBitOrder('msb');   // MSB first
SPI0.setFrequency(1_000_000);  // 1 MHz

// Chip select pin
const CS = D10;
CS.asOutput();
CS.high();  // Deselect device

Serial.println("SPI Basic Example");

while (true) {
  // Select device
  CS.low();
  
  // Send byte and receive response (full-duplex)
  const response = SPI0.transfer(0xAA);
  
  // Deselect device
  CS.high();
  
  Serial.println(`Sent: 0xAA, Received: 0x${response.toString(16)}`);
  
  delay(1000);
  
  // Transfer multiple bytes
  CS.low();
  
  SPI0.transfer(0x80);  // Command byte
  SPI0.transfer(0x00);  // Data byte 1
  SPI0.transfer(0xFF);  // Data byte 2
  
  CS.high();
  
  delay(1000);
}