// ---------------------------------------------------------------------------
// Example 2c — Serial Fluent Read Operations
//
// Demonstrates the fluent read API for UART/Serial.
// Shows: Serial.read.line(), Serial.read.until(), Serial.read.bytes()
// ---------------------------------------------------------------------------

import { Serial } from '@typecode/board-arduino-uno';

Serial.begin(115200);
Serial.println("Serial Fluent Read Example");

while (true) {
  // Read until newline with 5 second timeout
  const lineResult = Serial.read.line(5000);
  if (lineResult.ok) {
    Serial.print("Received line: ");
    Serial.println(lineResult.asStringTrim());
  } else if (lineResult.timedOut) {
    Serial.println("Timeout waiting for line");
  }

  // Read until specific delimiter
  const colonResult = Serial.read.until(':', 3000);
  if (colonResult.ok) {
    Serial.print("Until colon: ");
    Serial.println(colonResult.asString());
  }

  // Read until Enter key (handles \r, \n, or \r\n)
  const enterResult = Serial.read.untilEnter(5000);
  if (enterResult.ok) {
    Serial.print("You entered: ");
    Serial.println(enterResult.asStringTrim());
  }

  // Read until space
  const wordResult = Serial.read.untilSpace(3000);
  if (wordResult.ok) {
    Serial.print("Word: ");
    Serial.println(wordResult.asString());
  }

  // Read exact number of bytes
  const bytesResult = Serial.read.bytes(4, 3000);
  if (bytesResult.ok) {
    Serial.print("Got ");
    Serial.print(bytesResult.bytesRead);
    Serial.println(" bytes");
    
    // Parse as different types
    const value = bytesResult.asUint16('be');  // Big-endian 16-bit
    Serial.print("As uint16: ");
    Serial.println(value);
  }

  // Read all available bytes
  if (Serial.available() > 0) {
    const allResult = Serial.read.all();
    Serial.print("All available: ");
    Serial.println(allResult.asString());
  }

  // Read a single byte
  const byteResult = Serial.read.byte();
  if (byteResult.ok) {
    Serial.print("Byte: ");
    Serial.println(byteResult.asUint8());
  }
}