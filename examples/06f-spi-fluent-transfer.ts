// ---------------------------------------------------------------------------
// Example 6f — SPI Fluent Transfer (Experimental)
//
// Demonstrates the fluent transfer API for full-duplex SPI communication.
// Shows: SPI0.device(CS).transfer(data).execute()
//        Result.ok, Result.bytes, Result.asUint8()
//
// NOTE: This API is type-safe but requires transpiler support.
// ---------------------------------------------------------------------------

import { SPI0, Serial, D10 } from '@typecode/board-arduino-uno';
import { delay } from '@typecode/board-arduino-uno';

Serial.initialize({ baudRate: 9600 });

// Fluent configuration
SPI0.config
  .frequency(1_000_000)
  .mode(0)
  .bitOrder('msb')
  .begin();

const CS = D10;
CS.asOutput();

Serial.println("SPI Fluent Transfer Example");

while (true) {
  // Single byte transfer
  const result1 = SPI0.device(CS).transfer(0x55).execute();
  
  if (result1.ok) {
    const received = result1.asUint8();
    Serial.println(`Transfer 0x55, received 0x${received.toString(16)}`);
  }
  
  delay(500);
  
  // Multi-byte buffer transfer
  const txData = new Uint8Array([0x80, 0x00, 0x00, 0x00]);
  const result2 = SPI0.device(CS).transfer(txData).execute();
  
  if (result2.ok) {
    // Received bytes are in result2.bytes
    const rxData = result2.bytes;
    
    // Combine into a 32-bit value (big-endian)
    const value = (rxData[0] << 24) | (rxData[1] << 16) | (rxData[2] << 8) | rxData[3];
    Serial.println(`32-bit value: ${value}`);
  }
  
  delay(1000);
}