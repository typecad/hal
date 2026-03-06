// ---------------------------------------------------------------------------
// Example 2d — Serial Fluent Write Operations
//
// Demonstrates the fluent write API for UART/Serial.
// Shows: Serial.write.line(), Serial.write.format(), Serial.write.bytes()
// ---------------------------------------------------------------------------

import { Serial } from '@typecode/board-arduino-uno';

Serial.begin(115200);

// Write line with CRLF (\r\n)
Serial.write.line("Hello World");  // "Hello World\r\n"

// Write line with LF only
Serial.write.ln("Unix style");     // "Unix style\n"

// Write string without line ending
Serial.write.string("No newline here");

// Write single character
Serial.write.char('A');            // Writes byte 65
Serial.write.char(66);             // Writes byte 66 ('B')

// Write raw bytes
Serial.write.bytes([0x01, 0x02, 0x03]);
Serial.write.bytes(new Uint8Array([0xFF, 0xFE]));

// Write single byte
Serial.write.byte(0x00);

// Printf-style formatting (no newline)
Serial.write.format("Value: %d, Hex: 0x%02X", 42, 255);

// Printf-style formatting with CRLF
Serial.write.formatln("Count: %d, Float: %.2f", 10, 3.14159);

// Write 16-bit values (big-endian and little-endian)
Serial.write.uint16(0x1234, 'be');  // Writes 0x12, 0x34
Serial.write.uint16(0x1234, 'le');  // Writes 0x34, 0x12
Serial.write.int16(-100, 'be');

// Write 32-bit values
Serial.write.uint32(0x12345678, 'be');
Serial.write.int32(-1000, 'le');

// Check write result
const result = Serial.write.line("Test");
if (result.ok) {
  Serial.print("Wrote ");
  Serial.print(result.bytesWritten);
  Serial.println(" bytes");
}

// Arduino-compatible style still works
Serial.print("Classic ");
Serial.println("style");