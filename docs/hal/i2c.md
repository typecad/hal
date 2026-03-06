# I2C (Two-Wire Interface)

TypeCode provides a type-safe I2C API that mirrors Arduino's Wire library while adding compile-time safety and documentation.

## Multiple I2C Buses

TypeCode supports multiple I2C buses using numbered identifiers: `I2C0`, `I2C1`, `I2C2`, etc.

| Identifier | Arduino Mapping | Availability |
|------------|-----------------|--------------|
| `I2C0` | `Wire` | Most boards |
| `I2C1` | `Wire1` | ESP32, STM32, boards with multiple I2C |
| `I2C2` | `Wire2` | Some STM32 boards |

### Checking Board Capacity

Each board package defines how many I2C buses are available:

```typescript
// Arduino Uno: Only I2C0 available
import { I2C0 } from '@typecode/board-arduino-uno';
I2C0.begin();  // ✓ Valid

// ESP32: I2C0 and I2C1 available
import { I2C0, I2C1 } from '@typecode/board-esp32-devkit';
I2C0.begin();  // ✓ Valid
I2C1.begin();  // ✓ Valid
```

### Compile-Time Validation

Using an unavailable I2C bus generates a compile-time error:

```typescript
// On Arduino Uno (only has I2C0)
I2C1.begin();  // ✗ Error: I2C1 is not available on Arduino Uno. Available: I2C0
```

## Overview

The I2C (Inter-Integrated Circuit) bus is a two-wire serial protocol for communicating with sensors, displays, EEPROMs, and other peripherals.

| Feature | Support |
|---------|---------|
| Master mode | ✅ Full |
| Slave mode | ✅ Full |
| Multi-master | ⚠️ Not supported by Wire |
| Clock stretching | ✅ Automatic |
| Repeated start | ✅ Via endTransmission(false) |

## API Reference

### Initialization

#### Master Mode

```typescript
import { I2C0 } from '@typecode/board-arduino-uno';

// Initialize as master (no address parameter)
I2C0.begin();

// Set clock speed (optional, default 100kHz)
I2C0.setClock(400000);  // 400kHz fast mode
```

#### Slave Mode

```typescript
// Initialize as slave with address
I2C0.begin(0x08);  // 7-bit address

// Register receive callback
I2C0.onReceive((howMany: number) => {
  while (I2C0.available() > 0) {
    const data = I2C0.read();
    // Process received data
  }
});

// Register request callback
I2C0.onRequest(() => {
  I2C0.write(0x42);  // Send response to master
});
```

### Master Write Operations

#### beginTransmission(address)

Start a write transaction to the specified device.

```typescript
I2C0.beginTransmission(0x76);  // Device address
```

#### write(data)

Queue data for transmission. Returns number of bytes queued.

```typescript
// Single byte
I2C0.write(0xFA);

// Multiple bytes
I2C0.write(0xF4);
I2C0.write(0x27);

// From array
const data = new Uint8Array([0x01, 0x02, 0x03]);
for (const byte of data) {
  I2C0.write(byte);
}
```

#### endTransmission(stop?)

Execute the queued transmission. Returns status code.

```typescript
const status = I2C0.endTransmission();        // With STOP condition
const status = I2C0.endTransmission(true);   // With STOP condition
const status = I2C0.endTransmission(false);  // Without STOP (repeated start)
```

**Return Values (I2CStatus enum):**

| Status | Value | Description |
|--------|-------|-------------|
| `SUCCESS` | 0 | Transmission successful |
| `DATA_TOO_LONG` | 1 | Transmit buffer overflow |
| `NACK_ON_ADDRESS` | 2 | NACK on address (device not found) |
| `NACK_ON_DATA` | 3 | NACK on data byte |
| `OTHER_ERROR` | 4 | Unknown error |

### Master Read Operations

#### requestFrom(address, count, stop?)

Request bytes from a device. Returns bytes actually received.

```typescript
const bytesReceived = I2C0.requestFrom(0x76, 6);  // Request 6 bytes
const bytesReceived = I2C0.requestFrom(0x76, 6, true);   // With STOP
const bytesReceived = I2C0.requestFrom(0x76, 6, false);  // Without STOP
```

#### available()

Returns number of bytes available to read.

```typescript
while (I2C0.available() > 0) {
  const data = I2C0.read();
}
```

#### read()

Read one byte from receive buffer. Returns -1 if no data available.

```typescript
const byte = I2C0.read();
if (byte >= 0) {
  // Valid data
}
```

### Utility Functions

#### setClock(frequency)

Set I2C clock speed.

```typescript
I2C0.setClock(100000);  // 100kHz standard mode (default)
I2C0.setClock(400000);  // 400kHz fast mode
```

#### recover()

Attempt to recover a stuck I2C bus. Returns true if successful.

```typescript
if (I2C0.recover()) {
  Serial.println("Bus recovered");
}
```

## Error Handling

Always check the return value of `endTransmission()` for proper error handling:

```typescript
import { I2CStatus } from '@typecode/core';

I2C0.beginTransmission(0x76);
I2C0.write(0xFA);
const status = I2C0.endTransmission();

switch (status) {
  case I2CStatus.SUCCESS:
    // Continue with read
    break;
  case I2CStatus.NACK_ON_ADDRESS:
    Serial.println("Device not responding");
    break;
  case I2CStatus.NACK_ON_DATA:
    Serial.println("Device rejected data");
    break;
  case I2CStatus.DATA_TOO_LONG:
    Serial.println("Buffer overflow");
    break;
  default:
    Serial.println("Unknown error");
}
```

## Common Patterns

### Read Register

```typescript
function readRegister(addr: number, reg: number): number | null {
  I2C0.beginTransmission(addr);
  I2C0.write(reg);
  if (I2C0.endTransmission() !== 0) return null;
  
  if (I2C0.requestFrom(addr, 1) > 0) {
    return I2C0.read();
  }
  return null;
}
```

### Write Register

```typescript
function writeRegister(addr: number, reg: number, value: number): boolean {
  I2C0.beginTransmission(addr);
  I2C0.write(reg);
  I2C0.write(value);
  return I2C0.endTransmission() === 0;
}
```

### Read Multi-Byte Register (Big-Endian)

```typescript
function readUint16BE(addr: number, reg: number): number | null {
  I2C0.beginTransmission(addr);
  I2C0.write(reg);
  if (I2C0.endTransmission() !== 0) return null;
  
  if (I2C0.requestFrom(addr, 2) >= 2) {
    const msb = I2C0.read();
    const lsb = I2C0.read();
    return (msb << 8) | lsb;
  }
  return null;
}
```

### Bus Scan

```typescript
function scanBus(): number[] {
  const found: number[] = [];
  
  for (let addr = 0x08; addr <= 0x77; addr++) {
    I2C0.beginTransmission(addr);
    if (I2C0.endTransmission() === 0) {
      found.push(addr);
    }
  }
  
  return found;
}
```

## Fluent API (Experimental)

The fluent API provides a chainable, expressive interface for I2C operations. It's fully type-safe but currently requires additional transpiler support to generate Wire library calls.

### Fluent Configuration

```typescript
// Chain configuration options
I2C0.config
  .speed(400000)    // 400kHz fast mode
  .begin();         // Initialize

// With custom pins (for boards with multiple I2C buses)
I2C0.config
  .sda(21)          // SDA pin
  .scl(22)          // SCL pin
  .speed(100000)    // 100kHz standard mode
  .begin();
```

### Fluent Read

```typescript
// Read 2 bytes from register 0xFA
const result = I2C0.device(0x76).read(2).from(0xFA);

if (result.ok) {
  // Big-endian (MSB first)
  const tempRaw = result.asUint16('be');
  
  // Little-endian (LSB first)
  const dataRaw = result.asUint16('le');
  
  // Single byte
  const byte = result.asUint8();
  
  // Raw bytes array
  const bytes = result.bytes;
}

// Error handling
if (!result.ok) {
  Serial.println(`Read failed: ${result.status}`);
}
```

### Fluent Write

```typescript
// Write single byte to register
const result = I2C0.device(0x76).write(0x27).to(0xF4);

if (result.ok) {
  Serial.println(`Wrote ${result.bytesWritten} bytes`);
}

// Write multiple bytes
const data = new Uint8Array([0x01, 0x02, 0x03]);
const result = I2C0.device(0x76).write(data).to(0x88);
```

### Complete Fluent Example

```typescript
import { I2C0, Serial } from '@typecode/board-arduino-uno';
import { delay } from '@typecode/board-arduino-uno';

Serial.initialize({ baudRate: 9600 });

// Fluent configuration
I2C0.config
  .speed(400000)
  .begin();

const BME280_ADDR = 0x76;

while (true) {
  // Fluent read
  const result = I2C0.device(BME280_ADDR).read(2).from(0xFA);
  
  if (result.ok) {
    const tempRaw = result.asUint16('be');
    Serial.println(tempRaw / 100.0);
  }
  
  delay(1000);
}
```

> **Note:** The fluent API is designed for readability and type safety. For production code on Arduino, use the Wire-compatible API which has full transpiler support.

## Examples

| Example | Description |
|---------|-------------|
| [05-i2c-sensor.ts](../../examples/05-i2c-sensor.ts) | Basic sensor reading (Wire API) |
| [05b-i2c-error-handling.ts](../../examples/05b-i2c-error-handling.ts) | Error handling patterns |
| [05c-i2c-multi-byte-write.ts](../../examples/05c-i2c-multi-byte-write.ts) | Multi-byte writes |
| [05d-i2c-bus-scan.ts](../../examples/05d-i2c-bus-scan.ts) | Device scanning |
| [05e-i2c-multiple-devices.ts](../../examples/05e-i2c-multiple-devices.ts) | Multiple devices |
| [05f-i2c-slave-mode.ts](../../examples/05f-i2c-slave-mode.ts) | Slave mode |
| [05g-i2c-fluent-config.ts](../../examples/05g-i2c-fluent-config.ts) | Fluent configuration (experimental) |
| [05h-i2c-fluent-read.ts](../../examples/05h-i2c-fluent-read.ts) | Fluent read operations (experimental) |
| [05i-i2c-fluent-write.ts](../../examples/05i-i2c-fluent-write.ts) | Fluent write operations (experimental) |

## Hardware Setup

### Arduino Uno I2C Pins

| Signal | Pin | Alternative |
|--------|-----|-------------|
| SDA | A4 | SDA alias |
| SCL | A5 | SCL alias |

### Pull-up Resistors

I2C requires pull-up resistors on SDA and SCL lines:

- **4.7kΩ** for standard mode (100kHz)
- **2.2kΩ** for fast mode (400kHz)

Many I2C modules include built-in pull-ups. Check your module's documentation.

### Common Addresses

| Device | Address(es) |
|--------|-------------|
| SSD1306 OLED | 0x3C, 0x3D |
| BME280/BMP280 | 0x76, 0x77 |
| MPU-6050 | 0x68, 0x69 |
| DS3231 RTC | 0x68 |
| PCF8574 I/O | 0x20-0x27 |
| 24Cxx EEPROM | 0x50-0x57 |

## Troubleshooting

### Device Not Responding (NACK on Address)

1. Check wiring (SDA, SCL, VCC, GND)
2. Verify device address (try bus scan)
3. Check pull-up resistors
4. Verify device power

### Data Corruption

1. Reduce clock speed
2. Check for bus contention
3. Verify ground connection
4. Add decoupling capacitors

### Bus Hang

1. Call `I2C0.recover()` to attempt recovery
2. Power cycle devices
3. Check for short circuits on SDA/SCL