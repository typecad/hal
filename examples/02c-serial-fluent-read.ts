// ---------------------------------------------------------------------------
// Example 2c — Serial Fluent Read Operations
//
// Demonstrates the fluent read API for UART/Serial.
// Shows: Serial.read.line(), Serial.read.until(), Serial.read.bytes()
// ---------------------------------------------------------------------------

import { UART0 } from '@typecode/board-arduino-uno';

UART0.begin(115200);
UART0.println("Serial Fluent Read Example");

while (true) {
  // Read until newline with 5 second timeout
  const lineResult = UART0.read.line(5000);
  if (lineResult.ok) {
    UART0.print("Received line: ");
    UART0.println(lineResult.asStringTrim());
  } else if (lineResult.timedOut) {
    UART0.println("Timeout waiting for line");
  }

  // Read until specific delimiter
  const colonResult = UART0.read.until(':', 3000);
  if (colonResult.ok) {
    UART0.print("Until colon: ");
    UART0.println(colonResult.asString());
  }

  // Read until Enter key (handles \r, \n, or \r\n)
  const enterResult = UART0.read.untilEnter(5000);
  if (enterResult.ok) {
    UART0.print("You entered: ");
    UART0.println(enterResult.asStringTrim());
  }

  // Read until space
  const wordResult = UART0.read.untilSpace(3000);
  if (wordResult.ok) {
    UART0.print("Word: ");
    UART0.println(wordResult.asString());
  }

  // Read exact number of bytes
  const bytesResult = UART0.read.bytes(4, 3000);
  if (bytesResult.ok) {
    UART0.print("Got ");
    UART0.print(bytesResult.bytesRead);
    UART0.println(" bytes");
    
    // Parse as different types
    const value = bytesResult.asUint16('be');  // Big-endian 16-bit
    UART0.print("As uint16: ");
    UART0.println(value);
  }

  // Read all available bytes
  if (UART0.available() > 0) {
    const allResult = UART0.read.all();
    UART0.print("All available: ");
    UART0.println(allResult.asString());
  }

  // Read a single byte
  const byteResult = UART0.read.byte();
  if (byteResult.ok) {
    UART0.print("Byte: ");
    UART0.println(byteResult.asUint8());
  }
}
