# SPI (Serial Peripheral Interface)

TypeCode provides a type-safe SPI API that mirrors Arduino's SPI library while adding compile-time safety and a fluent chainable interface.

## Overview

SPI is a high-speed synchronous serial protocol for communicating with sensors, displays, SD cards, and other peripherals.

| Feature | Support |
|---------|---------|
| Master mode | ✅ Full |
| Slave mode | ⚠️ Limited |
| Multi-device | ✅ Via chip select |
| Transactions | ✅ Full |

## API Reference

### Initialization

#### Basic Initialization

```typescript
import { SPI0 } from '@typecode/board-arduino-uno';

SPI0.begin();
SPI0.setMode(0);
SPI0.setBitOrder('msb');
SPI0.setFrequency(1_000_000);
```

#### Fluent Configuration

```typescript
SPI0.config
  .frequency(4_000_000)    // 4 MHz
  .mode(0)                  // SPI mode 0
  .bitOrder('msb')          // MSB first
  .begin();
```

### Arduino-Compatible API

#### begin()

Initialize SPI bus with default settings.

```typescript
SPI0.begin();
```

#### setMode(mode)

Set SPI mode (0-3).

```typescript
SPI0.setMode(0);  // CPOL=0, CPHA=0
SPI0.setMode(1);  // CPOL=0, CPHA=1
SPI0.setMode(2);  // CPOL=1, CPHA=0
SPI0.setMode(3);  // CPOL=1, CPHA=1
```

| Mode | CPOL | CPHA | Clock Idle | Sample Edge |
|------|------|------|------------|-------------|
| 0 | 0 | 0 | LOW | Rising |
| 1 | 0 | 1 | LOW | Falling |
| 2 | 1 | 0 | HIGH | Falling |
| 3 | 1 | 1 | HIGH | Rising |

#### setBitOrder(order)

Set bit transmission order.

```typescript
SPI0.setBitOrder('msb');  // MSB first (most common)
SPI0.setBitOrder('lsb');  // LSB first
```

#### setFrequency(hz)

Set clock frequency in Hz.

```typescript
SPI0.setFrequency(1_000_000);   // 1 MHz
SPI0.setFrequency(4_000_000);   // 4 MHz
SPI0.setFrequency(8_000_000);   // 8 MHz (max on 16MHz Arduino)
```

#### transfer(data)

Transfer single byte (full-duplex). Returns received byte.

```typescript
const received = SPI0.transfer(0xAA);
```

#### transferBuffer(buffer)

Transfer buffer (full-duplex). Buffer is modified in place.

```typescript
const buffer = new Uint8Array([0x80, 0x00, 0x00]);
SPI0.transferBuffer(buffer);
// buffer now contains received data
```

#### write(data)

Write single byte (ignores received data).

```typescript
SPI0.write(0x55);
```

#### write16(data)

Write 16-bit value.

```typescript
SPI0.write16(0x1234);
```

#### beginTransaction(settings)

Start transaction with specific settings.

```typescript
SPI0.beginTransaction({
  frequency: 4_000_000,
  mode: 0,
  bitOrder: 'msb'
});
// ... SPI operations ...
SPI0.endTransaction();
```

#### endTransaction()

End current transaction.

### Fluent Device API

#### device(chipSelect)

Create device context for fluent operations.

```typescript
const device = SPI0.device(CS_PIN);
```

#### write(data).to(register)

Write to device register.

```typescript
const result = SPI0.device(CS).write(0x27).to(0x0F);
if (result.ok) {
  console.log(`Wrote ${result.bytesWritten} bytes`);
}
```

#### read(count).from(register)

Read from device register.

```typescript
const result = SPI0.device(CS).read(2).from(0x30);
if (result.ok) {
  const value = result.asUint16('be');
}
```

#### transfer(data).execute()

Full-duplex transfer with automatic CS handling.

```typescript
const result = SPI0.device(CS).transfer(new Uint8Array([0x80, 0x00])).execute();
if (result.ok) {
  const response = result.bytes;
}
```

## Common Patterns

### Basic Transfer with Chip Select

```typescript
import { SPI0, D10 } from '@typecode/board-arduino-uno';

const CS = D10;
CS.asOutput();
CS.high();

SPI0.begin();

// Transfer
CS.low();
const response = SPI0.transfer(0xAA);
CS.high();
```

### Read Device Register

```typescript
function readRegister(cs: IDigitalPin, reg: number): number {
  cs.low();
  SPI0.transfer(reg | 0x80);  // Set read bit
  const value = SPI0.transfer(0xFF);
  cs.high();
  return value;
}
```

### Write Device Register

```typescript
function writeRegister(cs: IDigitalPin, reg: number, value: number): void {
  cs.low();
  SPI0.transfer(reg & 0x7F);  // Clear read bit
  SPI0.transfer(value);
  cs.high();
}
```

### Multiple Devices

```typescript
import { SPI0, D10, D9 } from '@typecode/board-arduino-uno';

const CS_DEVICE1 = D10;
const CS_DEVICE2 = D9;

CS_DEVICE1.asOutput();
CS_DEVICE2.asOutput();
CS_DEVICE1.high();
CS_DEVICE2.high();

SPI0.begin();

// Communicate with device 1
CS_DEVICE1.low();
SPI0.transfer(0x55);
CS_DEVICE1.high();

// Communicate with device 2
CS_DEVICE2.low();
SPI0.transfer(0xAA);
CS_DEVICE2.high();
```

## Hardware Setup

### Arduino Uno SPI Pins

| Signal | Pin | Alternative |
|--------|-----|-------------|
| MOSI | D11 | MOSI alias |
| MISO | D12 | MISO alias |
| SCK | D13 | SCK alias |
| SS | D10 | SS alias (hardware) |

### Multiple Chip Selects

Use any digital pin for chip select:

```typescript
import { D6, D7, D8 } from '@typecode/board-arduino-uno';

const CS1 = D6;
const CS2 = D7;
const CS3 = D8;
```

### Wiring Diagram

```
Arduino          Device
-------          ------
D11 (MOSI) ---> SI/MOSI
D12 (MISO) <--- SO/MISO
D13 (SCK)  ---> SCK
D10 (SS)   ---> CS
5V         ---> VCC
GND        ---> GND
```

## SPI Modes Explained

### Mode 0 (Most Common)

- Clock idle LOW
- Data sampled on rising edge
- Used by most sensors and displays

### Mode 1

- Clock idle LOW
- Data sampled on falling edge

### Mode 2

- Clock idle HIGH
- Data sampled on falling edge

### Mode 3

- Clock idle HIGH
- Data sampled on rising edge

## Examples

| Example | Description |
|---------|-------------|
| [06-spi-basic.ts](../../examples/06-spi-basic.ts) | Basic SPI operations |
| [06b-spi-transactions.ts](../../examples/06b-spi-transactions.ts) | Transaction API |
| [06c-spi-shift-register.ts](../../examples/06c-spi-shift-register.ts) | 74HC595 shift register |
| [06d-spi-fluent-config.ts](../../examples/06d-spi-fluent-config.ts) | Fluent configuration |
| [06e-spi-fluent-device.ts](../../examples/06e-spi-fluent-device.ts) | Fluent device operations |
| [06f-spi-fluent-transfer.ts](../../examples/06f-spi-fluent-transfer.ts) | Fluent transfer |

## Troubleshooting

### No Response from Device

1. Check wiring (MOSI, MISO, SCK, CS, VCC, GND)
2. Verify SPI mode matches device requirements
3. Check chip select polarity (usually active LOW)
4. Verify clock frequency is within device specs

### Wrong Data

1. Check bit order (MSB vs LSB)
2. Verify SPI mode
3. Check for proper chip select timing
4. Verify data format (command byte, address bytes)

### Slow Performance

1. Increase clock frequency
2. Use transactions for multiple transfers
3. Minimize chip select toggling
4. Consider DMA for large transfers (advanced boards)

## Comparison: Arduino vs Fluent API

| Operation | Arduino API | Fluent API |
|-----------|-------------|------------|
| Init | `SPI.begin(); SPI.setClockDivider(4);` | `SPI0.config.frequency(4_000_000).begin()` |
| Write reg | `digitalWrite(CS,LOW); SPI.transfer(reg); SPI.transfer(data); digitalWrite(CS,HIGH);` | `SPI0.device(CS).write(data).to(reg)` |
| Read reg | `digitalWrite(CS,LOW); SPI.transfer(reg\|0x80); byte v = SPI.transfer(0); digitalWrite(CS,HIGH);` | `SPI0.device(CS).read(1).from(reg).asUint8()` |