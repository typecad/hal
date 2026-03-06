// ---------------------------------------------------------------------------
// Example 6e — SPI Fluent Device Operations (Experimental)
//
// Demonstrates the fluent device API for SPI register read/write.
// Shows: SPI0.device(CS).write(data).to(register)
//        SPI0.device(CS).read(count).from(register)
//
// NOTE: This API is type-safe but requires transpiler support.
// ---------------------------------------------------------------------------

import { SPI0, Serial, D10, HIGH } from '@typecode/board-arduino-uno';
import { delay } from '@typecode/board-arduino-uno';

Serial.initialize({ baudRate: 9600 });

// Fluent configuration
SPI0.config
  .frequency(4_000_000)
  .mode(0)
  .bitOrder('msb')
  .begin();

const CS = D10;
CS.config.output.initial(HIGH);

Serial.println("SPI Fluent Device Example");

// Write configuration to device register
const writeResult = SPI0.device(CS).write(0x27).to(0x0F);
if (writeResult.ok) {
  Serial.println(`Wrote ${writeResult.bytesWritten} bytes`);
} else {
  Serial.println(`Write failed: ${writeResult.status}`);
}

delay(100);

while (true) {
  // Read 2 bytes from register 0x30
  const result = SPI0.device(CS).read(2).from(0x30);
  
  if (result.ok) {
    // Get as big-endian 16-bit value
    const value = result.asUint16('be');
    Serial.println(`Value: ${value}`);
    
    // Or access raw bytes
    const bytes = result.bytes;
    Serial.println(`Bytes: ${bytes[0]}, ${bytes[1]}`);
  } else {
    Serial.println(`Read failed: ${result.status}`);
  }
  
  delay(1000);
}