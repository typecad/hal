// ---------------------------------------------------------------------------
// Example 2d — Serial Fluent Write Operations
//
// Demonstrates the fluent write API for UART/Serial.
// Shows: Serial.write.line(), Serial.write.format(), Serial.write.bytes()
// ---------------------------------------------------------------------------

import { UART0 } from '@typecode';

UART0.config.baudRate(9600).begin();

// Write line with CRLF (\r\n)
UART0.write.line("Hello World");  // "Hello World\r\n"

// Write line with LF only
UART0.write.ln("Unix style");     // "Unix style\n"

// Write string without line ending
UART0.write.string("No newline here");

// Write single character
UART0.write.char('A');            // Writes byte 65
UART0.write.char(66);             // Writes byte 66 ('B')

// Write raw bytes
UART0.write.bytes([0x01, 0x02, 0x03]);
UART0.write.bytes(new Uint8Array([0xFF, 0xFE]));

// Write single byte
UART0.write.byte(0x00);

// Printf-style formatting (no newline)
UART0.write.format("Value: %d, Hex: 0x%02X", 42, 255);

// Printf-style formatting with CRLF
UART0.write.formatln("Count: %d, Float: %.2f", 10, 3.14159);

// Write 16-bit values (big-endian and little-endian)
UART0.write.uint16(0x1234, 'be');  // Writes 0x12, 0x34
UART0.write.uint16(0x1234, 'le');  // Writes 0x34, 0x12
UART0.write.int16(-100, 'be');

// Write 32-bit values
UART0.write.uint32(0x12345678, 'be');
UART0.write.int32(-1000, 'le');

// Check write result
const result = UART0.write.line("Test");
if (result.ok) {
  UART0.print("Wrote ");
  UART0.print(result.bytesWritten);
  UART0.println(" bytes");
}

// Arduino-compatible style still works
UART0.print("Classic ");
UART0.println("style");
