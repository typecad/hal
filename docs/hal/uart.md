# UART / Serial

TypeCode provides a type-safe UART/Serial API that mirrors Arduino's Serial library while adding compile-time safety, fluent chainable configuration, and result-based operations.

## Overview

The UART (Universal Asynchronous Receiver-Transmitter) is a serial communication protocol for communicating with computers, other microcontrollers, and serial peripherals.

| Feature | Support |
|---------|---------|
| TX/RX | ✅ Full |
| Variable baud rate | ✅ Full |
| Parity options | ✅ Full |
| Flow control | ✅ Hardware & Software |
| USB-CDC | ✅ Automatic |

## API Reference

### Initialization

#### Arduino-Compatible Style

```typescript
import { Serial } from '@typecode/board-arduino-uno';

// Simple initialization with baud rate
Serial.begin(9600);

// Check if initialized
if (Serial.isInitialized) {
  Serial.println("Serial ready");
}
```

#### Fluent Configuration Style

```typescript
import { Serial } from '@typecode/board-arduino-uno';
import { UARTParity, UARTStopBits, UARTFlowControl } from '@typecode/core';

// Full configuration with all options
Serial.config
  .baudRate(115200)
  .dataBits(8)
  .parity(UARTParity.NONE)
  .stopBits(UARTStopBits.ONE)
  .flowControl(UARTFlowControl.NONE)
  .defaultTimeout(5000)  // 5 second default for read operations
  .begin();

// Simple configuration
Serial.config
  .baudRate(9600)
  .begin();
```

### Arduino-Compatible Write Operations

#### print(...args)

Print values without newline.

```typescript
Serial.print("Hello");
Serial.print("Value: ", 42);
Serial.print(3.14159);
```

#### println(...args)

Print values with newline (CRLF on Arduino).

```typescript
Serial.println("Hello World");
Serial.println("Count: ", 10);
```

#### printf(format, ...args)

Printf-style formatted output.

```typescript
Serial.printf("Temperature: %.2f°C\n", 23.5);
Serial.printf("Hex: 0x%02X, Dec: %d\n", 255, 255);
```

#### write(data)

Write raw data. Returns number of bytes written.

```typescript
// Single byte
Serial.write(0x41);  // 'A'

// Byte array
Serial.write(new Uint8Array([0x01, 0x02, 0x03]));

// String
Serial.write("Hello");
```

### Arduino-Compatible Read Operations

#### available()

Returns number of bytes available to read.

```typescript
if (Serial.available() > 0) {
  const data = Serial.read();
}
```

#### read()

Read a single byte. Returns -1 if no data available.

```typescript
const byte = Serial.read();
if (byte >= 0) {
  // Valid data
}
```

#### peek()

Look at next byte without consuming it.

```typescript
const nextByte = Serial.peek();
```

#### flush()

Wait for transmission to complete.

```typescript
Serial.flush();
```

### Fluent Write Operations

The fluent write API provides chainable methods with result checking.

#### write.line(text)

Write text followed by CRLF (\r\n).

```typescript
const result = Serial.write.line("Hello World");
// Sends: "Hello World\r\n"
```

#### write.ln(text)

Write text followed by LF only (\n).

```typescript
const result = Serial.write.ln("Unix style");
// Sends: "Unix style\n"
```

#### write.string(text)

Write raw string without line ending.

```typescript
const result = Serial.write.string("No newline");
```

#### write.char(c)

Write a single character/byte.

```typescript
Serial.write.char('A');   // Character
Serial.write.char(65);    // Same, by ASCII code
```

#### write.byte(value)

Write a single byte value (0-255).

```typescript
Serial.write.byte(0xFF);
```

#### write.bytes(data)

Write raw bytes from array.

```typescript
Serial.write.bytes([0x01, 0x02, 0x03]);
Serial.write.bytes(new Uint8Array([0xFF, 0xFE]));
```

#### write.format(fmt, ...args)

Printf-style formatting without newline.

```typescript
Serial.write.format("Value: %d, Hex: 0x%02X", 42, 255);
```

#### write.formatln(fmt, ...args)

Printf-style formatting with CRLF.

```typescript
Serial.write.formatln("Count: %d, Float: %.2f", 10, 3.14);
```

#### write.uint16(value, endian)

Write 16-bit unsigned integer.

```typescript
Serial.write.uint16(0x1234, 'be');  // Big-endian: 0x12, 0x34
Serial.write.uint16(0x1234, 'le');  // Little-endian: 0x34, 0x12
```

#### write.int16(value, endian)

Write 16-bit signed integer.

```typescript
Serial.write.int16(-100, 'be');
```

#### write.uint32(value, endian) / write.int32(value, endian)

Write 32-bit integers.

```typescript
Serial.write.uint32(0x12345678, 'be');
Serial.write.int32(-1000, 'le');
```

### Fluent Read Operations

The fluent read API provides chainable methods with timeout support and result checking.

#### read.line(timeout?)

Read until newline (\n or \r\n).

```typescript
const result = Serial.read.line(5000);  // 5 second timeout

if (result.ok) {
  Serial.println(result.asStringTrim());
} else if (result.timedOut) {
  Serial.println("Timeout!");
}
```

#### read.until(delimiter, timeout?)

Read until specific character or string.

```typescript
// Until character
const result = Serial.read.until(':', 3000);

// Until string
const result = Serial.read.until("OK", 5000);

// Until byte value
const result = Serial.read.until(0x0D, 3000);  // CR
```

#### read.untilEnter(timeout?)

Read until Enter key (handles \r, \n, or \r\n).

```typescript
Serial.print("Enter name: ");
const result = Serial.read.untilEnter(10000);
if (result.ok) {
  Serial.print("Hello, ");
  Serial.println(result.asStringTrim());
}
```

#### read.untilSpace(timeout?)

Read until space character.

```typescript
const word = Serial.read.untilSpace(3000);
```

#### read.untilTab(timeout?)

Read until tab character.

```typescript
const field = Serial.read.untilTab(3000);
```

#### read.bytes(count, timeout?)

Read exact number of bytes.

```typescript
const result = Serial.read.bytes(4, 3000);

if (result.ok) {
  // Parse as different types
  const val16 = result.asUint16('be');
  const val32 = result.asUint32('le');
}
```

#### read.all()

Read all available bytes.

```typescript
if (Serial.available() > 0) {
  const result = Serial.read.all();
  Serial.println(result.asString());
}
```

#### read.byte()

Read a single byte with result wrapper.

```typescript
const result = Serial.read.byte();
if (result.ok) {
  Serial.println(result.asUint8());
}
```

#### read.char()

Read a single character as string.

```typescript
const result = Serial.read.char();
if (result.ok) {
  Serial.println(result.asString());
}
```

### Result Type Methods

All fluent read operations return `IUARTReadResult` with these methods:

```typescript
interface IUARTReadResult {
  ok: boolean;           // True if successful
  status: UARTStatus;    // Status code
  bytes: Uint8Array;     // Raw bytes read
  bytesRead: number;     // Number of bytes read
  timedOut: boolean;     // True if operation timed out
  
  // Type conversions
  asString(): string;          // UTF-8 string
  asStringTrim(): string;      // Trimmed string
  asInt(): number;             // Parse as integer
  asFloat(): number;           // Parse as float
  asUint8(): number;           // First byte as unsigned
  asInt8(): number;            // First byte as signed
  asUint16(endian): number;    // 16-bit unsigned
  asInt16(endian): number;     // 16-bit signed
  asUint32(endian): number;    // 32-bit unsigned
  asInt32(endian): number;     // 32-bit signed
}
```

All fluent write operations return `IUARTWriteResult`:

```typescript
interface IUARTWriteResult {
  ok: boolean;           // True if successful
  status: UARTStatus;    // Status code
  bytesWritten: number;  // Number of bytes written
}
```

### Status Codes

```typescript
enum UARTStatus {
  SUCCESS = 0,
  NOT_INITIALIZED = 1,
  TIMEOUT = 2,
  BUFFER_OVERFLOW = 3,
  OVERRUN_ERROR = 4,
  PARITY_ERROR = 5,
  FRAMING_ERROR = 6,
  BREAK_DETECTED = 7,
  WRITE_FAILED = 8,
  READ_FAILED = 9,
}
```

### Callbacks

#### onReceive(callback)

Register callback for when data is received.

```typescript
Serial.onReceive((bytesAvailable: number) => {
  Serial.println(`${bytesAvailable} bytes received`);
});
```

#### onTransmitComplete(callback)

Register callback for when transmission completes.

```typescript
Serial.onTransmitComplete(() => {
  // Safe to send more data
});
```

#### onError(callback)

Register callback for errors.

```typescript
Serial.onError((error: UARTError) => {
  Serial.println(`UART Error: ${error.message}`);
});
```

## Common Patterns

### Command Parser

```typescript
Serial.begin(115200);
Serial.println("Ready. Commands: temp, led ON, led OFF");

while (true) {
  const cmd = Serial.read.untilEnter(10000);
  
  if (cmd.ok) {
    const input = cmd.asStringTrim().toLowerCase();
    
    if (input === "temp") {
      Serial.write.formatln("Temperature: %.2f°C", readTemp());
    } else if (input === "led on") {
      LED.high();
      Serial.write.line("LED is ON");
    } else if (input === "led off") {
      LED.low();
      Serial.write.line("LED is OFF");
    } else {
      Serial.write.line("Unknown command");
    }
  }
}
```

### Binary Protocol

```typescript
// Send binary frame: [0xAA][0x55][cmd][len][data...][checksum]
function sendFrame(cmd: number, data: Uint8Array) {
  Serial.write.byte(0xAA);
  Serial.write.byte(0x55);
  Serial.write.byte(cmd);
  Serial.write.byte(data.length);
  Serial.write.bytes(data);
  
  let checksum = cmd ^ data.length;
  for (const b of data) checksum ^= b;
  Serial.write.byte(checksum);
}

// Read binary frame
function readFrame(): { cmd: number; data: Uint8Array } | null {
  const header = Serial.read.bytes(4, 1000);
  if (!header.ok) return null;
  
  if (header.bytes[0] !== 0xAA || header.bytes[1] !== 0x55) {
    return null;
  }
  
  const cmd = header.bytes[2];
  const len = header.bytes[3];
  
  const data = Serial.read.bytes(len + 1, 1000);
  if (!data.ok) return null;
  
  // Verify checksum
  let checksum = cmd ^ len;
  for (let i = 0; i < len; i++) checksum ^= data.bytes[i];
  if (checksum !== data.bytes[len]) return null;
  
  return { cmd, data: data.bytes.slice(0, len) };
}
```

### Non-Polling with Callbacks

```typescript
Serial.begin(115200);

Serial.onReceive((available) => {
  while (available-- > 0) {
    const byte = Serial.read();
    processByte(byte);
  }
});

// Main loop does other work
while (true) {
  // Other tasks...
}
```

## Examples

| Example | Description |
|---------|-------------|
| [02-analog-serial.ts](../../examples/02-analog-serial.ts) | Basic serial output (Arduino style) |
| [02b-serial-fluent-config.ts](../../examples/02b-serial-fluent-config.ts) | Fluent configuration |
| [02c-serial-fluent-read.ts](../../examples/02c-serial-fluent-read.ts) | Fluent read operations |
| [02d-serial-fluent-write.ts](../../examples/02d-serial-fluent-write.ts) | Fluent write operations |

## Hardware Setup

### Arduino Uno Serial Pins

| Signal | Pin | Notes |
|--------|-----|-------|
| TX | D1 | Transmit to RX of other device |
| RX | D0 | Receive from TX of other device |
| USB | - | USB-CDC serial (Serial) |

### Voltage Levels

- Arduino Uno uses 5V logic levels
- Connect 3.3V devices through level shifter
- Never connect RS-232 directly (use MAX232 or similar)

### Common Baud Rates

| Baud Rate | Use Case |
|-----------|----------|
| 9600 | Standard, most compatible |
| 19200 | Modbus, legacy devices |
| 38400 | Faster communication |
| 57600 | Common for GPS |
| 115200 | High-speed, debugging |
| 230400+ | Very high-speed applications |

## Troubleshooting

### Garbage Characters

1. Check baud rates match on both ends
2. Verify data bits (usually 8)
3. Check parity settings
4. Verify stop bits

### No Output

1. Check TX/RX connections (crossed)
2. Verify correct COM port
3. Check for USB-CDC vs hardware serial

### Buffer Overflow

1. Read data faster (use callbacks)
2. Increase buffer size
3. Implement flow control

### Timeout Issues

1. Increase timeout value
2. Check device is responding
3. Verify wiring