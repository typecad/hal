# UART / Serial

TypeCode provides a type-safe UART/Serial API that mirrors Arduino's Serial library while adding compile-time safety, fluent chainable configuration, and result-based operations.

## Multiple UART Ports

TypeCode supports multiple UART ports using numbered identifiers: `UART0`, `UART1`, `UART2`, etc.

| Identifier | Arduino Mapping | Availability |
|------------|-----------------|--------------|
| `UART0` | `Serial` | Most boards (USB-CDC) |
| `UART1` | `Serial1` | ESP32, STM32, Arduino Mega |
| `UART2` | `Serial2` | ESP32, some STM32 boards |

### Checking Board Capacity

Each board package defines how many UART ports are available:

```typescript
// Arduino Uno: Only UART0 available (USB-CDC)
import { UART0 } from '@typecode/board-arduino-uno';
UART0.config.baudRate(9600).begin();  // ✓ Valid

// ESP32: UART0, UART1, UART2 available
import { UART0, UART1, UART2 } from '@typecode/board-esp32-devkit';
UART0.config.baudRate(115200).begin();  // USB-CDC
UART1.config.baudRate(9600).begin();    // Hardware serial on GPIO pins
UART2.config.baudRate(9600).begin();    // Another hardware serial
```

### Compile-Time Validation

Using an unavailable UART port generates a compile-time error:

```typescript
// On Arduino Uno (only has UART0)
UART1.begin(9600);  // ✗ Error: UART1 is not available on Arduino Uno. Available: UART0 (Serial)
```

### Hardware Serial vs USB-CDC

| Port | Arduino Uno | ESP32 | Notes |
|------|-------------|-------|-------|
| UART0 | USB-CDC only | USB-CDC + GPIO 1/3 | USB serial |
| UART1 | N/A | GPIO pins | Hardware serial |
| UART2 | N/A | GPIO pins | Hardware serial |

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
import { UART0 } from '@typecode/board-arduino-uno';

// Simple initialization with baud rate
UART0.begin(9600);

// Check if initialized
if (UART0.isInitialized) {
  UART0.println("Serial ready");
}
```

#### Fluent Configuration Style

```typescript
import { UART0 } from '@typecode/board-arduino-uno';
import { UARTParity, UARTStopBits, UARTFlowControl } from '@typecode/core';

// Full configuration with all options
UART0.config
  .baudRate(115200)
  .dataBits(8)
  .parity(UARTParity.NONE)
  .stopBits(UARTStopBits.ONE)
  .flowControl(UARTFlowControl.NONE)
  .defaultTimeout(5000)  // 5 second default for read operations
  .begin();

// Simple configuration
UART0.config
  .baudRate(9600)
  .begin();
```

### Arduino-Compatible Write Operations

#### print(...args)

Print values without newline.

```typescript
UART0.print("Hello");
UART0.print("Value: ", 42);
UART0.print(3.14159);
```

#### println(...args)

Print values with newline (CRLF on Arduino).

```typescript
UART0.println("Hello World");
UART0.println("Count: ", 10);
```

#### printf(format, ...args)

Printf-style formatted output.

```typescript
UART0.printf("Temperature: %.2f°C\n", 23.5);
UART0.printf("Hex: 0x%02X, Dec: %d\n", 255, 255);
```

#### write(data)

Write raw data. Returns number of bytes written.

```typescript
// Single byte
UART0.write(0x41);  // 'A'

// Byte array
UART0.write(new Uint8Array([0x01, 0x02, 0x03]));

// String
UART0.write("Hello");
```

### Arduino-Compatible Read Operations

#### available()

Returns number of bytes available to read.

```typescript
if (UART0.available() > 0) {
  const data = UART0.read();
}
```

#### read()

Read a single byte. Returns -1 if no data available.

```typescript
const byte = UART0.read();
if (byte >= 0) {
  // Valid data
}
```

#### peek()

Look at next byte without consuming it.

```typescript
const nextByte = UART0.peek();
```

#### flush()

Wait for transmission to complete.

```typescript
UART0.flush();
```

### Fluent Write Operations

The fluent write API provides chainable methods with result checking.

#### write.line(text)

Write text followed by CRLF (\r\n).

```typescript
const result = UART0.write.line("Hello World");
// Sends: "Hello World\r\n"
```

#### write.ln(text)

Write text followed by LF only (\n).

```typescript
const result = UART0.write.ln("Unix style");
// Sends: "Unix style\n"
```

#### write.string(text)

Write raw string without line ending.

```typescript
const result = UART0.write.string("No newline");
```

#### write.char(c)

Write a single character/byte.

```typescript
UART0.write.char('A');   // Character
UART0.write.char(65);    // Same, by ASCII code
```

#### write.byte(value)

Write a single byte value (0-255).

```typescript
UART0.write.byte(0xFF);
```

#### write.bytes(data)

Write raw bytes from array.

```typescript
UART0.write.bytes([0x01, 0x02, 0x03]);
UART0.write.bytes(new Uint8Array([0xFF, 0xFE]));
```

#### write.format(fmt, ...args)

Printf-style formatting without newline.

```typescript
UART0.write.format("Value: %d, Hex: 0x%02X", 42, 255);
```

#### write.formatln(fmt, ...args)

Printf-style formatting with CRLF.

```typescript
UART0.write.formatln("Count: %d, Float: %.2f", 10, 3.14);
```

#### write.uint16(value, endian)

Write 16-bit unsigned integer.

```typescript
UART0.write.uint16(0x1234, 'be');  // Big-endian: 0x12, 0x34
UART0.write.uint16(0x1234, 'le');  // Little-endian: 0x34, 0x12
```

#### write.int16(value, endian)

Write 16-bit signed integer.

```typescript
UART0.write.int16(-100, 'be');
```

#### write.uint32(value, endian) / write.int32(value, endian)

Write 32-bit integers.

```typescript
UART0.write.uint32(0x12345678, 'be');
UART0.write.int32(-1000, 'le');
```

### Fluent Read Operations

The fluent read API provides chainable methods with timeout support and result checking.

#### read.line(timeout?)

Read until newline (\n or \r\n).

```typescript
const result = UART0.read.line(5000);  // 5 second timeout

if (result.ok) {
  UART0.println(result.asStringTrim());
} else if (result.timedOut) {
  UART0.println("Timeout!");
}
```

#### read.until(delimiter, timeout?)

Read until specific character or string.

```typescript
// Until character
const result = UART0.read.until(':', 3000);

// Until string
const result = UART0.read.until("OK", 5000);

// Until byte value
const result = UART0.read.until(0x0D, 3000);  // CR
```

#### read.untilEnter(timeout?)

Read until Enter key (handles \r, \n, or \r\n).

```typescript
UART0.print("Enter name: ");
const result = UART0.read.untilEnter(10000);
if (result.ok) {
  UART0.print("Hello, ");
  UART0.println(result.asStringTrim());
}
```

#### read.untilSpace(timeout?)

Read until space character.

```typescript
const word = UART0.read.untilSpace(3000);
```

#### read.untilTab(timeout?)

Read until tab character.

```typescript
const field = UART0.read.untilTab(3000);
```

#### read.bytes(count, timeout?)

Read exact number of bytes.

```typescript
const result = UART0.read.bytes(4, 3000);

if (result.ok) {
  // Parse as different types
  const val16 = result.asUint16('be');
  const val32 = result.asUint32('le');
}
```

#### read.all()

Read all available bytes.

```typescript
if (UART0.available() > 0) {
  const result = UART0.read.all();
  UART0.println(result.asString());
}
```

#### read.byte()

Read a single byte with result wrapper.

```typescript
const result = UART0.read.byte();
if (result.ok) {
  UART0.println(result.asUint8());
}
```

#### read.char()

Read a single character as string.

```typescript
const result = UART0.read.char();
if (result.ok) {
  UART0.println(result.asString());
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
UART0.onReceive((bytesAvailable: number) => {
  UART0.println(`${bytesAvailable} bytes received`);
});
```

#### onTransmitComplete(callback)

Register callback for when transmission completes.

```typescript
UART0.onTransmitComplete(() => {
  // Safe to send more data
});
```

#### onError(callback)

Register callback for errors.

```typescript
UART0.onError((error: UARTError) => {
  UART0.println(`UART Error: ${error.message}`);
});
```

## Common Patterns

### Command Parser

```typescript
UART0.begin(115200);
UART0.println("Ready. Commands: temp, led ON, led OFF");

while (true) {
  const cmd = UART0.read.untilEnter(10000);
  
  if (cmd.ok) {
    const input = cmd.asStringTrim().toLowerCase();
    
    if (input === "temp") {
      UART0.write.formatln("Temperature: %.2f°C", readTemp());
    } else if (input === "led on") {
      LED.high();
      UART0.write.line("LED is ON");
    } else if (input === "led off") {
      LED.low();
      UART0.write.line("LED is OFF");
    } else {
      UART0.write.line("Unknown command");
    }
  }
}
```

### Binary Protocol

```typescript
// Send binary frame: [0xAA][0x55][cmd][len][data...][checksum]
function sendFrame(cmd: number, data: Uint8Array) {
  UART0.write.byte(0xAA);
  UART0.write.byte(0x55);
  UART0.write.byte(cmd);
  UART0.write.byte(data.length);
  UART0.write.bytes(data);
  
  let checksum = cmd ^ data.length;
  for (const b of data) checksum ^= b;
  UART0.write.byte(checksum);
}

// Read binary frame
function readFrame(): { cmd: number; data: Uint8Array } | null {
  const header = UART0.read.bytes(4, 1000);
  if (!header.ok) return null;
  
  if (header.bytes[0] !== 0xAA || header.bytes[1] !== 0x55) {
    return null;
  }
  
  const cmd = header.bytes[2];
  const len = header.bytes[3];
  
  const data = UART0.read.bytes(len + 1, 1000);
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
UART0.begin(115200);

UART0.onReceive((available) => {
  while (available-- > 0) {
    const byte = UART0.read();
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