# Arduino Uno TypeCode SDK — Usage Guide

The `@typecode/board-arduino-uno` package provides a fully-typed TypeScript
SDK for the Arduino Uno (ATmega328P).  Every pin, peripheral, and timing
function carries rich type information so that TypeScript catches hardware
errors **at compile time** — before you flash anything.

---

## Quick Start

```typescript
// typecode.config.ts
import type { TypecodeConfig } from './code/core/config';

const config: TypecodeConfig = {
  target: 'avr',
  board: '@typecode/board-arduino-uno',
  fqbn: 'arduino:avr:uno',
  output: { framework: 'arduino', optimize: 'size' },
};
export default config;
```

Then create your firmware in TypeScript and transpile:

```bash
npx tsc -p tsconfig.json                         # build the transpiler
node dist/cli.js transpile main.ts \
  --target arduino --fqbn arduino:avr:uno         # TS → C++
arduino-cli compile --fqbn arduino:avr:uno main   # compile to hex
arduino-cli upload  --fqbn arduino:avr:uno -p COM3 main  # flash
```

---

## Importing

There are two import styles — pick whichever you prefer.

### Style 1: Individual imports (tree-shakeable)

```typescript
import { D13, A0 }        from '@typecode/board-arduino-uno/pins';
import { UART0 }          from '@typecode/board-arduino-uno/peripherals';
import { delay, millis }  from '@typecode/board-arduino-uno/timing';
```

### Style 2: Unified `Board` namespace

```typescript
import { Board } from '@typecode/board-arduino-uno/board';

Board.D13.high();
Board.UART0.println("Hello");
```

### Style 3: Barrel import (everything)

```typescript
import {
  D13, A0, LED, UART0, delay, millis,
  I2C0, SPI0, Board,
} from '@typecode/board-arduino-uno';
```

### Style 4: Virtual `@typecode` import (recommended)

```typescript
import { D13, A0, LED, UART0, delay, millis, I2C0, SPI0, Board } from '@typecode';
```

---

## Pin System

### Pin types at a glance

| Export | TypeScript Type | Capabilities |
|--------|----------------|--------------|
| `D0`, `D1` | `IDigitalPin & IInterruptPin` | Digital I/O + external interrupt |
| `D2` | `IDigitalPin & IInterruptPin` | Digital I/O + INT0 |
| `D3` | `IPWMPin` | Digital I/O + PWM (Timer2B) + INT1 |
| `D4`, `D7`, `D8`, `D12` | `IDigitalPin` | Digital I/O only |
| `D5`, `D6` | `IPWMPin` | Digital I/O + PWM (Timer0) |
| `D9`, `D10`, `D11` | `IPWMPin` | Digital I/O + PWM (Timer1/2) |
| `D13` | `IDigitalPin` | Digital I/O (+ onboard LED) |
| `A0`–`A5` | `IAnalogInput` | 10-bit ADC input |

### Convenience Aliases

| Alias | Points to | Function |
|-------|-----------|----------|
| `LED` | `D13` | Onboard LED |
| `SDA` | `A4` | I2C data |
| `SCL` | `A5` | I2C clock |
| `MOSI` | `D11` | SPI master out |
| `MISO` | `D12` | SPI master in |
| `SCK` | `D13` | SPI clock |
| `SS` | `D10` | SPI slave select |
| `TX` | `D1` | UART transmit |
| `RX` | `D0` | UART receive |

### Type Safety in Action

```typescript
import { D4, A0 } from './code/board-arduino-uno/pins';

// ✅ OK  — D4 is IDigitalPin, supports .high()
D4.high();

// ✅ OK  — A0 is IAnalogInput, supports .read()
const value = A0.read();

// ❌ COMPILE ERROR — IAnalogInput has no .high() method
A0.high();  // Property 'high' does not exist on type 'IAnalogInput'

// ❌ COMPILE ERROR — IDigitalPin has no .setDutyCycle()
D4.setDutyCycle(128);  // Property 'setDutyCycle' does not exist on type 'IDigitalPin'

// ✅ OK  — D5 is IPWMPin, supports .setDutyCycle()
import { D5 } from './code/board-arduino-uno/pins';
D5.setDutyCycle(128);
```

---

## Examples

Each example below is a complete, self-contained `.ts` file that the
transpiler converts to a valid `.ino` sketch.

### 1. Blink (Hello World)

```typescript
// examples/01-blink.ts
import { LED, delay, HIGH } from '@typecode';

LED.config.output(HIGH);

while (true) {
  LED.toggle();
  delay(1000);
}
```

**Generated C++:**
```cpp
void setup() {
  pinMode(13, OUTPUT);
}
void loop() {
  digitalWrite(13, !digitalRead(13));
  delay(1000);
}
```

---

### 2. Analog Read → Serial

```typescript
// examples/02-analog-serial.ts
import { A0, UART0, delay } from '@typecode';

UART0.config.baudRate(9600).begin();

while (true) {
  const value = A0.read();
  UART0.write.line(value.toString());
  delay(500);
}
```

---

### 3. PWM Fade

```typescript
// examples/03-pwm-fade.ts
import { D9, delay, LOW } from '@typecode';

D9.config.output(LOW);

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

### 4. External Interrupt (Button)

```typescript
// examples/04-interrupt.ts
import { D2, LED, LOW } from '@typecode';

LED.config.output(LOW);
D2.config.input.pullup();

let ledState = false;

D2.on.falling(() => {
  ledState = !ledState;
  if (ledState) {
    LED.high();
  } else {
    LED.low();
  }
});
```

---

### 5. I2C — Read From a Sensor (Fluent API)

```typescript
// examples/05-i2c-sensor.ts
import { I2C0, UART0, delay } from '@typecode';

UART0.config.baudRate(9600).begin();
I2C0.config.begin();               // Wire.begin() - master mode

const BME280_ADDR = 0x76;

while (true) {
  // Read 2 bytes from register 0xFA (temperature data)
  const tempData = I2C0.device(BME280_ADDR).readBytes(0xFA, 2);
  const msb = tempData[0];
  const lsb = tempData[1];
  const tempRaw = (msb << 8) | lsb;
  const temperature = tempRaw / 100.0;
  
  UART0.write.line(temperature.toString());
  delay(1000);
}
```

---

### 6. SPI — Write to a Shift Register

```typescript
// examples/06-spi-shift-register.ts
import { SPI0, SS, delay, LOW } from '@typecode';

SPI0.config.frequency(1_000_000).begin();
SS.config.output(LOW);

let pattern = 0b00000001;

while (true) {
  SPI0.device(SS).write(pattern);

  // rotate left
  pattern = ((pattern << 1) | (pattern >> 7)) & 0xFF;
  delay(200);
}
```

---

### 7. Board Namespace (All-In-One)

```typescript
// examples/07-board-namespace.ts
import { Board, LOW } from '@typecode';

Board.UART0.config.baudRate(115200).begin();
Board.LED.config.output(LOW);

Board.UART0.println("Arduino Uno booted");
Board.UART0.println("MCU: " + Board.definition.mcu);
Board.UART0.println("Flash: " + Board.definition.memory.flash + " bytes");

while (true) {
  const sensor = Board.A0.read();
  Board.UART0.write.line(sensor.toString());
  Board.LED.toggle();
}
```

---

## Peripheral Reference

### Serial (UART 0)

```typescript
import { UART0 } from '@typecode';

UART0.config.baudRate(9600).begin();
UART0.println("Hello, World!");
UART0.print("Value: ");
UART0.println(42);
UART0.flush();   // wait for transmit buffer to empty
```

### I2C0 (Wire)

The I2C interface supports two API styles:

#### Fluent API (Recommended)

```typescript
import { I2C0, UART0 } from '@typecode';
import { I2CStatus } from '@typecode/core';

// Initialize as master with fluent config
I2C0.config.speed(400000).begin();  // 400 kHz fast mode

const DEVICE_ADDR = 0x76;

// Read bytes from a register
const data = I2C0.device(DEVICE_ADDR).readBytes(0xFA, 2);
UART0.write.line(`Received: ${data[0]}, ${data[1]}`);

// Write bytes to a register
const result = I2C0.device(DEVICE_ADDR).write(0x27).to(0xF4);
if (!result.ok) {
  UART0.write.line(`Write failed: ${result.status}`);
}
```

#### Wire-Compatible API (Legacy)

This API directly maps to Arduino's Wire library:

```typescript
import { I2C0 } from '@typecode';
import { I2CStatus } from '@typecode/core';

// Initialize as master
I2C0.begin();

// Set clock speed (optional, default 100kHz)
I2C0.setClock(400000);  // 400 kHz fast mode

// Write to a device with error checking
I2C0.beginTransmission(0x68);  // MPU-6050 address
I2C0.write(0x6B);              // PWR_MGMT_1 register
I2C0.write(0x00);              // wake up
const status = I2C0.endTransmission();

// Check status (I2CStatus enum)
if (status === I2CStatus.SUCCESS) {
  // Write succeeded
} else if (status === I2CStatus.NACK_ON_ADDRESS) {
  // Device not responding
}

// Read from a device
I2C0.beginTransmission(0x68);
I2C0.write(0x75);              // WHO_AM_I register
I2C0.endTransmission();

const bytesReceived = I2C0.requestFrom(0x68, 1);
if (bytesReceived > 0) {
  const whoAmI = I2C0.read();
}
```

#### Error Codes (I2CStatus)

| Status | Value | Description |
|--------|-------|-------------|
| `SUCCESS` | 0 | Operation completed successfully |
| `DATA_TOO_LONG` | 1 | Transmit buffer overflow |
| `NACK_ON_ADDRESS` | 2 | NACK received on address (device not found) |
| `NACK_ON_DATA` | 3 | NACK received on data byte |
| `OTHER_ERROR` | 4 | Other error |
| `PARTIAL_READ` | 5 | Fewer bytes read than requested |

### SPI0

```typescript
import { SPI0, SS, D10 } from '@typecode';

// Fluent configuration
SPI0.config.frequency(4_000_000).mode(0).bitOrder('msb').begin();

// Chip select pin
const CS = D10;
CS.config.output.initial(true);  // HIGH = deselected

// Single byte transfer with fluent device API
const response = SPI0.device(CS).transfer(0x55);

// Write data to device
SPI0.device(CS).write(0xFF);

// Multi-byte transfer
const rxData = SPI0.device(CS).transfer(new Uint8Array([0x80, 0x00, 0xFF]));
```

---

## Timing Functions

```typescript
import { delay, millis, micros, delayMicroseconds } from '@typecode';

delay(1000);             // block 1 second
delayMicroseconds(10);   // block 10 µs

const t = millis();      // ms since reset
const us = micros();     // µs since reset
```

---

## Utility Functions

```typescript
import { map, constrain } from '@typecode';

// Re-map a 10-bit ADC reading (0–1023) to an 8-bit PWM range (0–255)
const pwmValue = map(sensorReading, 0, 1023, 0, 255);

// Clamp a value to the valid PWM range
const clamped = constrain(pwmValue, 0, 255);
```

---

## Board Definition Metadata

The `ArduinoUno` constant (or `Board.definition`) exposes the full hardware
manifest at design time.

```typescript
import { ArduinoUno, Board } from '@typecode';

// Access via ArduinoUno export
console.log(ArduinoUno.name);             // "Arduino Uno"
console.log(ArduinoUno.mcu);              // "ATmega328P"
console.log(ArduinoUno.clockSpeed);       // 16000000
console.log(ArduinoUno.memory.flash);     // 32768
console.log(ArduinoUno.memory.sram);      // 2048
console.log(ArduinoUno.memory.eeprom);    // 1024
console.log(ArduinoUno.pins.pwm);         // ["D3","D5","D6","D9","D10","D11"]
console.log(ArduinoUno.features.watchdog);// true
console.log(ArduinoUno.build.arduino);    // "arduino:avr:uno"

// Or via Board namespace
console.log(Board.definition.name);       // "Arduino Uno"
```

---

## Project Structure (Recommended)

```
my-project/
├── typecode.config.ts           ← board + target selection
├── main.ts                      ← your firmware
├── lib/
│   └── bme280.ts                ← reusable driver (uses core interfaces)
├── code/
│   ├── core/                    ← @typecode/core type system
│   └── board-arduino-uno/       ← board SDK
│       ├── index.ts             ← barrel export + ArduinoUno manifest
│       ├── board.ts             ← Board namespace (single-import)
│       ├── pins.ts              ← Typed pin exports (D0-D13, A0-A5)
│       ├── peripherals.ts       ← I2C0, SPI0, Serial stubs
│       ├── timing.ts            ← delay, millis, micros
│       ├── analog.ts            ← analogReference
│       └── interrupts.ts        ← noInterrupts, attachInterrupt
└── out/                         ← generated .ino files
```
