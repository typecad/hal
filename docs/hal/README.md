# TypeCode HAL Reference

The Hardware Abstraction Layer provides TypeScript APIs for embedded development. Import from `@typecode` and write TypeScript that compiles to efficient C++.

```typescript
import { LED, D2, A0, I2C0, Serial, delay } from '@typecode';

LED.asOutput();
while (true) {
  LED.toggle();
  delay(1000);
}
```

---

## Digital I/O

### Available Pins

| Pin Type | Example | Description |
|----------|---------|-------------|
| Digital | `D0`-`D13` | Digital-only or digital+PWM pins |
| Analog | `A0`-`A5` | Analog input pins (also digital-capable) |
| Special | `LED` | On-board LED (usually D13) |

### Setting Pin Mode

```typescript
import { D2, LED } from '@typecode';

D2.asInput();        // INPUT
D2.asOutput();       // OUTPUT
D2.asInputPullUp();  // INPUT_PULLUP
D2.asInputPullDown(); // INPUT_PULLDOWN (if supported)
```

### Digital Output

```typescript
LED.asOutput();

LED.high();      // Set HIGH
LED.low();       // Set LOW
LED.toggle();    // Toggle state
LED.write(true); // Write boolean
LED.pulse(100);  // 100ms pulse (HIGH-LOW)
```

### Digital Input

```typescript
D2.asInput();

if (D2.isHigh()) {
  // Pin is HIGH
}

if (D2.isLow()) {
  // Pin is LOW
}

const value = D2.read(); // Returns HIGH, LOW, or boolean
```

### Input with Pull-up/Pull-down

```typescript
// Button with internal pull-up (active-low button)
D2.asInputPullUp();

if (D2.isLow()) {
  // Button pressed (pulled LOW when pressed)
}
```

---

## Analog Input

### Reading Analog Values

```typescript
import { A0 } from '@typecode';

const raw = A0.read();           // Raw ADC value (0-1023 on 10-bit ADC)
const volts = A0.readVoltage();  // Voltage (0-5V on 5V boards)
const bits = A0.getResolution(); // ADC resolution in bits
```

### Example: Potentiometer

```typescript
import { A0, Serial, delay } from '@typecode';

Serial.initialize({ baudRate: 9600 });

while (true) {
  const value = A0.read();
  Serial.println(value);
  delay(500);
}
```

### Setting Reference Voltage

```typescript
A0.setReference(3.3); // Set reference to 3.3V
```

---

## PWM Output

PWM-capable pins (varies by board - on Arduino Uno: D3, D5, D6, D9, D10, D11):

### Basic PWM

```typescript
import { D9 } from '@typecode';

D9.asOutput();
D9.write(128);  // 50% duty cycle (0-255 on 8-bit PWM)
```

### Advanced PWM Control

```typescript
D9.setFrequency(1000);   // 1 kHz
D9.setDutyCycle(127);    // ~50% duty

const freq = D9.getFrequency();
const res = D9.getResolution();  // Bits of resolution
```

### Example: LED Fade

```typescript
import { D9, delay } from '@typecode';

D9.asOutput();

let brightness = 0;
let step = 5;

while (true) {
  D9.write(brightness);
  brightness += step;
  
  if (brightness <= 0 || brightness >= 255) {
    step = -step;
  }
  delay(30);
}
```

---

## I2C Bus

TypeCode provides a Wire-compatible API for I2C communication. See [I2C Reference](./i2c.md) for complete documentation.

### Initialization

```typescript
import { I2C0 } from '@typecode';

// Master mode
I2C0.begin();
I2C0.setClock(400000);  // 400kHz fast mode

// Slave mode
I2C0.begin(0x08);  // 7-bit address
```

### Master Write

```typescript
const BME280_ADDR = 0x76;

I2C0.beginTransmission(BME280_ADDR);
I2C0.write(0xF4);  // Register
I2C0.write(0x27);  // Data
const status = I2C0.endTransmission();  // 0 = success
```

### Master Read

```typescript
I2C0.beginTransmission(BME280_ADDR);
I2C0.write(0xFA);  // Register to read
I2C0.endTransmission();

I2C0.requestFrom(BME280_ADDR, 2);  // Request 2 bytes
const msb = I2C0.read();
const lsb = I2C0.read();
```

### Error Handling

```typescript
import { I2CStatus } from '@typecode/core';

switch (status) {
  case I2CStatus.SUCCESS: break;
  case I2CStatus.NACK_ON_ADDRESS:
    Serial.println("Device not found");
    break;
}
```

### Example: BME280 Temperature

```typescript
import { I2C0, Serial, delay } from '@typecode';

Serial.initialize({ baudRate: 9600 });
I2C0.begin();
I2C0.setClock(400000);

const BME280_ADDR = 0x76;

while (true) {
  I2C0.beginTransmission(BME280_ADDR);
  I2C0.write(0xFA);
  I2C0.endTransmission();
  
  I2C0.requestFrom(BME280_ADDR, 2);
  const tempRaw = (I2C0.read() << 8) | I2C0.read();
  Serial.println(tempRaw / 100.0);
  delay(1000);
}
```

**See [I2C Reference](./i2c.md) for:**
- Slave mode (onReceive, onRequest)
- Error handling patterns
- Bus scanning
- Multiple devices
- Common patterns

---

## SPI Bus

TypeCode provides an Arduino-compatible SPI API with a fluent chainable interface. See [SPI Reference](./spi.md) for complete documentation.

### Initialization

```typescript
import { SPI0 } from '@typecode';

// Basic initialization
SPI0.begin();
SPI0.setMode(0);
SPI0.setFrequency(1_000_000);

// Fluent configuration
SPI0.config
  .frequency(4_000_000)
  .mode(0)
  .bitOrder('msb')
  .begin();
```

### Transfer (Full-Duplex)

```typescript
import { SPI0, D10 } from '@typecode';

const CS = D10;
CS.asOutput();
CS.high();

SPI0.begin();

CS.low();
const response = SPI0.transfer(0xAA);
CS.high();
```

### Transactions

```typescript
SPI0.beginTransaction({ frequency: 4_000_000, mode: 0, bitOrder: 'msb' });
// ... SPI operations ...
SPI0.endTransaction();
```

### Fluent Device API

```typescript
// Write to register
const result = SPI0.device(CS).write(0x27).to(0x0F);
if (result.ok) {
  Serial.println(`Wrote ${result.bytesWritten} bytes`);
}

// Read from register
const result = SPI0.device(CS).read(2).from(0x30);
if (result.ok) {
  const value = result.asUint16('be');
}
```

### Example: 74HC595 Shift Register

```typescript
import { SPI0, D10, delay } from '@typecode';

const LATCH = D10;
LATCH.asOutput();
LATCH.high();

SPI0.begin();
SPI0.setMode(0);

const patterns = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80];

while (true) {
  for (const pattern of patterns) {
    LATCH.low();
    SPI0.transfer(pattern);
    LATCH.high();
    delay(100);
  }
}
```

**See [SPI Reference](./spi.md) for:**
- SPI modes (0-3) explained
- Transaction API
- Multiple devices
- Fluent device operations

---

## UART / Serial

TypeCode provides an Arduino-compatible Serial API with fluent chainable configuration and result-based operations. See [UART Reference](./uart.md) for complete documentation.

### Initialization

```typescript
import { Serial } from '@typecode';

// Arduino-compatible style
Serial.begin(9600);

// Fluent configuration style
Serial.config
  .baudRate(115200)
  .defaultTimeout(5000)
  .begin();
```

### Writing (Arduino-Compatible)

```typescript
Serial.print("Hello");
Serial.println("World");
Serial.printf("Value: %d\n", 42);
Serial.write(0x41);  // Single byte
```

### Writing (Fluent API)

```typescript
Serial.write.line("Hello World");     // With CRLF
Serial.write.formatln("Temp: %.2f", 23.5);
Serial.write.bytes([0x01, 0x02, 0x03]);
Serial.write.uint16(0x1234, 'be');    // Big-endian
```

### Reading (Arduino-Compatible)

```typescript
if (Serial.available() > 0) {
  const byte = Serial.read();  // Returns -1 if none
}
const next = Serial.peek();  // Look ahead
```

### Reading (Fluent API)

```typescript
// Read until newline with timeout
const result = Serial.read.line(5000);
if (result.ok) {
  Serial.println(result.asStringTrim());
} else if (result.timedOut) {
  Serial.println("Timeout!");
}

// Read until delimiter
const word = Serial.read.untilSpace(3000);
const cmd = Serial.read.untilEnter(10000);

// Read exact bytes
const data = Serial.read.bytes(4, 3000);
if (data.ok) {
  const value = data.asUint16('be');
}
```

### Example: Command Parser

```typescript
import { Serial, LED } from '@typecode';

Serial.begin(115200);
Serial.println("Commands: ON, OFF, STATUS");

while (true) {
  const cmd = Serial.read.untilEnter(10000);
  
  if (cmd.ok) {
    const input = cmd.asStringTrim().toLowerCase();
    
    if (input === "on") {
      LED.high();
      Serial.write.line("LED ON");
    } else if (input === "off") {
      LED.low();
      Serial.write.line("LED OFF");
    }
  }
}
```

**See [UART Reference](./uart.md) for:**
- Fluent configuration options
- Binary protocols
- Result type methods
- Callbacks (onReceive, onError)

---

## Interrupts

Interrupt-capable pins vary by board. On Arduino Uno: D2 (INT0), D3 (INT1).

### Attach Interrupt

```typescript
import { D2, LED, InterruptMode } from '@typecode';

LED.asOutput();
D2.asInputPullUp();

D2.attachInterrupt(() => {
  LED.toggle();
}, InterruptMode.FALLING);
```

### Interrupt Modes

| Mode | Trigger |
|------|---------|
| `RISING` | Low → High transition |
| `FALLING` | High → Low transition |
| `CHANGE` | Any transition |
| `LOW` | Pin is LOW (level-triggered) |
| `HIGH` | Pin is HIGH (level-triggered, if supported) |

### Detach Interrupt

```typescript
D2.detachInterrupt();
```

### Check Interrupt Status

```typescript
if (D2.hasInterrupt()) {
  // Interrupt is attached
}
```

---

## Timing

### Delay

```typescript
import { delay } from '@typecode';

delay(1000);  // 1 second (blocking)
```

### Millis / Micros

```typescript
import { millis, micros } from '@typecode';

const start = millis();
// ... do work ...
const elapsed = millis() - start;

const us = micros();  // Microseconds since boot
```

### Example: Non-Blocking Blink

```typescript
import { LED, millis } from '@typecode';

LED.asOutput();

let lastToggle = 0;
let ledState = false;

while (true) {
  const now = millis();
  if (now - lastToggle >= 1000) {
    ledState = !ledState;
    if (ledState) LED.high();
    else LED.low();
    lastToggle = now;
  }
  
  // Other work can happen here
}
```

---

## Pin Reference

### Arduino Uno

| Pin | Digital | PWM | Analog | Interrupt | Notes |
|-----|---------|-----|--------|-----------|-------|
| D0 | ✓ | | | ✓ | RX |
| D1 | ✓ | | | ✓ | TX |
| D2 | ✓ | | | ✓ | INT0 |
| D3 | ✓ | ✓ | | ✓ | INT1 |
| D4 | ✓ | | | | |
| D5 | ✓ | ✓ | | | |
| D6 | ✓ | ✓ | | | |
| D7 | ✓ | | | | |
| D8 | ✓ | | | | |
| D9 | ✓ | ✓ | | | |
| D10 | ✓ | ✓ | | | SS |
| D11 | ✓ | ✓ | | | MOSI |
| D12 | ✓ | | | | MISO |
| D13 | ✓ | | | | SCK, LED |
| A0 | ✓ | | ✓ | | |
| A1 | ✓ | | ✓ | | |
| A2 | ✓ | | ✓ | | |
| A3 | ✓ | | ✓ | | |
| A4 | ✓ | | ✓ | | SDA |
| A5 | ✓ | | ✓ | | SCL |

### Convenience Aliases

```typescript
import { LED, SDA, SCL, MOSI, MISO, SCK, SS, TX, RX } from '@typecode';
```

---

## Type Safety

TypeCode provides compile-time checking. Attempting PWM on a non-PWM pin or `analogRead()` on a digital-only pin produces a TypeScript error:

```typescript
import { D4, D9 } from '@typecode';

D9.write(128);  // ✓ D9 supports PWM
D4.write(128);  // ✗ Error: D4 does not support PWM
```

---

## Related Documentation

- [Language Reference](../transpiler/language-reference.md) - TypeScript to C++ mapping
- [Board Packages](../board/) - Board-specific configuration
- [CLI Reference](../cli/reference.md) - Build and upload commands