# Board Package Usage Guide

This guide explains how to use board packages in your TypeCode projects.

## Installation

Board packages are typically installed as dependencies of the main `typecode` package. You can also install them explicitly:

```bash
npm install @typecode/board-arduino-uno
```

## Configuration

Configure your board in `typecode.config.ts`:

```typescript
import type { TypecodeConfig } from '@typecode/core';

const config: TypecodeConfig = {
  target: 'avr',
  board: '@typecode/board-arduino-uno',
  fqbn: 'arduino:avr:uno',
  output: { framework: 'arduino', optimize: 'size', outDir: './out' },
};

export default config;
```

### Available Board Packages

| Package | FQBN | Target | MCU |
|---------|------|--------|-----|
| `@typecode/board-arduino-uno` | `arduino:avr:uno` | `avr` | ATmega328P |
| `@typecode/board-arduino-nano33iot` | `arduino:samd:nano_33_iot` | `samd` | SAMD21 |
| `@typecode/board-esp32-devkit` | `esp32:esp32:esp32doit-devkit-v1` | `esp32` | ESP32 |

## Importing

There are three import styles — pick whichever you prefer.

### Style 1: Virtual `@typecode` Import (Recommended)

The transpiler resolves `@typecode` to your configured board package:

```typescript
import { Board, delay, LED } from '@typecode';
```

### Style 2: Individual imports (tree-shakeable)

```typescript
import { D13, A0 }        from '@typecode/board-arduino-uno/pins';
import { Serial }         from '@typecode/board-arduino-uno/peripherals';
import { delay, millis }  from '@typecode/board-arduino-uno/timing';
```

### Style 3: Unified `Board` namespace

```typescript
import { Board } from '@typecode/board-arduino-uno/board';

Board.D13.high();
Board.Serial.println("Hello");
```

### Style 4: Barrel import (everything)

```typescript
import {
  D13, A0, LED, Serial, delay, millis,
  I2C0, SPI0, Board,
} from '@typecode/board-arduino-uno';
```

## Pin System

### Pin Types

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

### Type Safety

```typescript
import { D4, A0, D5 } from '@typecode';

// ✅ OK  — D4 is IDigitalPin, supports .high()
D4.high();

// ✅ OK  — A0 is an analog-capable pin, supports .readAnalog()
const value = A0.readAnalog();

// ❌ COMPILE ERROR — analog-only helpers do not expose digital-only APIs as the primary path
A0.high();  // Property 'high' does not exist on type 'IAnalogInput'

// ❌ COMPILE ERROR — IDigitalPin has no .pwm()
D4.pwm(50);  // Property 'pwm' does not exist

// ✅ OK  — D5 is IPWMPin, supports .pwm(percent)
D5.pwm(50);
```

### Board-aware pin rules

Board packages carry conflict metadata, not just names. On Uno, TypeCode can tell you about these constraints before code generation:

| Pins | Reserved by | Why it matters |
|------|-------------|----------------|
| `D0`, `D1` | `UART0` | Using them as GPIO interferes with serial RX/TX |
| `A4`, `A5` | `I2C0` | Using them as GPIO conflicts with SDA/SCL |
| `D11`, `D12`, `D13` | `SPI0` | Using them as GPIO conflicts with MOSI/MISO/SCK |

This is a core TypeCode design goal: board metadata should make misuse obvious without forcing you to memorize the schematic.

The same metadata also helps with softer resource coupling:

- pin aliases such as `LED` and `D13` refer to the same physical pin, so mixing both names makes diagnostics harder to read
- PWM pins are grouped by timer on Uno: `D5/D6`, `D9/D10`, and `D3/D11`

When TypeCode warns about alias mixing or shared PWM timers, it is pointing at places where the board schematic leaks into behavior.

## Examples

### 1. Blink (Hello World)

```typescript
import { LED, delay, HIGH } from '@typecode';

LED.output(HIGH);

while (true) {
  LED.toggle();
  delay(1000);
}
```

### 2. Analog Read → Serial

```typescript
import { A0, UART0, delay } from '@typecode';

UART0.begin(9600);

while (true) {
  const value = A0.readAnalog();
  UART0.println(value.toString());
  delay(500);
}
```

### 3. PWM Fade

```typescript
import { D9, delay, LOW } from '@typecode';

D9.output(LOW);

let brightness = 0;
let step = 5;

while (true) {
  D9.pwm(brightness / 2.55);
  brightness += step;
  if (brightness <= 0 || brightness >= 255) {
    step = -step;
  }
  delay(30);
}
```

PWM timer note: on Uno, `D9` shares its timer with `D10`, so choose pins from different timer groups when you need independent PWM timing behavior.

### 4. External Interrupt (Button)

```typescript
import { D2, LED, LOW } from '@typecode';

LED.output(LOW);
D2.inputPullUp();

let ledState = false;

D2.onFalling(() => {
  ledState = !ledState;
  if (ledState) {
    LED.high();
  } else {
    LED.low();
  }
});
```

### 5. I2C — Read From a Sensor

```typescript
import { I2C0, UART0, delay } from '@typecode';

UART0.begin(9600);
const i2c = I2C0.begin();

const BME280_ADDR = 0x76;

while (true) {
  // Read 2 bytes from register 0xFA (temperature data)
  const tempData = i2c.device(BME280_ADDR).readBytes(0xfa, 2);
  const msb = tempData[0];
  const lsb = tempData[1];
  const tempRaw = (msb << 8) | lsb;
  const temperature = tempRaw / 100.0;
  UART0.println(temperature.toString());
  delay(1000);
}
```

### 6. SPI — Write to a Shift Register

```typescript
import { SPI0, SS, delay, LOW } from '@typecode';

const spi = SPI0.begin();
spi.setFrequency(1_000_000);
SS.output(LOW);

let pattern = 0b00000001;

while (true) {
  spi.device(SS).write(pattern);

  // rotate left
  pattern = ((pattern << 1) | (pattern >> 7)) & 0xFF;
  delay(200);
}
```

### 7. Board Namespace (All-In-One)

```typescript
import { Board, LOW } from '@typecode';

Board.UART0.begin(115200);
Board.LED.output(LOW);

Board.UART0.println("Arduino Uno booted");
Board.UART0.println("MCU: " + Board.definition.mcu);
Board.UART0.println("Flash: " + Board.definition.memory.flash + " bytes");

while (true) {
  const sensor = Board.A0.readAnalog();
  Board.UART0.println(sensor);
  Board.LED.toggle();
}
```

## Peripheral Reference

### Serial (UART 0)

```typescript
import { UART0 } from '@typecode';

// Initialize with baud rate
UART0.begin(9600);

// Write operations
UART0.println("Hello, World!");
UART0.print("Value: ");
UART0.printf("Number: %d", 42);

// Read operations
if (UART0.available() > 0) {
  const byte = UART0.read();
  UART0.println(byte);
}
```

### I2C0 (Wire)

```typescript
import { I2C0 } from '@typecode';

// Initialize with optional clock speed
const i2c = I2C0.begin();  // 100 kHz default
i2c.setClock(400000);      // optionally switch to 400 kHz fast mode

// Device accessor
const device = i2c.device(0x68);

// Read from register
const data = device.readBytes(0x75, 1);  // Read WHO_AM_I
const whoAmI = data[0];

// Write to register
device.writeByte(0x6B, 0x00);  // Wake MPU-6050
```

### SPI0

```typescript
import { SPI0, D10, HIGH } from '@typecode';

const CS = D10;

// Initialize and configure
const spi = SPI0.begin();
spi.setFrequency(1_000_000);
spi.setMode(0);
spi.setBitOrder('msb');

CS.output(HIGH);  // HIGH = deselected

// Transfer with device API (CS handled automatically)
const response = spi.device(CS).transfer(0x80);

// Multi-byte transfer
const rx = spi.device(CS).transfer(new Uint8Array([0x80, 0x00]));
```

## Timing Functions

```typescript
import { delay, millis, micros, delayMicroseconds } from '@typecode';

delay(1000);             // block 1 second
delayMicroseconds(10);   // block 10 µs

const t = millis();      // ms since reset
const us = micros();     // µs since reset
```

## Utility Functions

```typescript
import { map, constrain } from '@typecode';

// Re-map a 10-bit ADC reading (0–1023) to an 8-bit PWM range (0–255)
const pwmValue = map(sensorReading, 0, 1023, 0, 255);

// Clamp a value to the valid PWM range
const clamped = constrain(pwmValue, 0, 255);
```

## Board Definition Metadata

The `Board.definition` (or `ArduinoUno` constant) exposes the full hardware manifest:

```typescript
import { Board } from '@typecode';

console.log(Board.definition.name);             // "Arduino Uno"
console.log(Board.definition.mcu);              // "ATmega328P"
console.log(Board.definition.clockSpeed);       // 16000000
console.log(Board.definition.memory.flash);     // 32768
console.log(Board.definition.memory.sram);      // 2048
console.log(Board.definition.memory.eeprom);    // 1024
console.log(Board.definition.pins.pwm);         // ["D3","D5","D6","D9","D10","D11"]
console.log(Board.definition.features.watchdog);// true
console.log(Board.definition.build.arduino);    // "arduino:avr:uno"
```

## Project Structure (Recommended)

```
my-project/
├── typecode.config.ts           ← board + target selection
├── main.ts                      ← your firmware
├── lib/
│   └── bme280.ts                ← reusable driver (uses core interfaces)
└── out/                         ← generated .ino files