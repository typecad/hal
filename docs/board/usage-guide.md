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
D4.asOutput();
D4.high();

// ✅ OK  — A0 is IAnalogInput, supports .read()
const value = A0.read();

// ❌ COMPILE ERROR — IAnalogInput has no .high() method
A0.high();  // Property 'high' does not exist on type 'IAnalogInput'

// ❌ COMPILE ERROR — IDigitalPin has no .setDutyCycle()
D4.setDutyCycle(128);  // Property 'setDutyCycle' does not exist

// ✅ OK  — D5 is IPWMPin, supports .setDutyCycle()
D5.setDutyCycle(128);
```

## Examples

### 1. Blink (Hello World)

```typescript
import { LED } from '@typecode';
import { delay } from '@typecode';

LED.asOutput();

while (true) {
  LED.toggle();
  delay(1000);
}
```

### 2. Analog Read → Serial

```typescript
import { A0, Serial, delay } from '@typecode';

Serial.initialize({ baudRate: 9600 });

while (true) {
  const value = A0.read();
  Serial.println(value);
  delay(500);
}
```

### 3. PWM Fade

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

### 4. External Interrupt (Button)

```typescript
import { D2, LED, InterruptMode } from '@typecode';

LED.asOutput();
D2.asInputPullUp();

let ledState = false;

D2.attachInterrupt(() => {
  ledState = !ledState;
  if (ledState) { LED.high(); } else { LED.low(); }
}, InterruptMode.FALLING);
```

### 5. I2C — Read From a Sensor

```typescript
import { I2C0, Serial, delay } from '@typecode';

Serial.initialize({ baudRate: 9600 });
I2C0.initialize();          // Wire.begin()

const BME280_ADDR = 0x76;

while (true) {
  const tempRaw = I2C0.readWord(BME280_ADDR, 0xFA);
  const temperature = tempRaw / 100.0;
  Serial.println(temperature);
  delay(1000);
}
```

### 6. SPI — Write to a Shift Register

```typescript
import { SPI0, Serial, SS, delay } from '@typecode';

SPI0.initialize({ frequency: 1_000_000 });
SS.asOutput();

let pattern = 0b00000001;

while (true) {
  SS.low();
  SPI0.write(new Uint8Array([pattern]));
  SS.high();

  pattern = ((pattern << 1) | (pattern >> 7)) & 0xFF; // rotate left
  delay(200);
}
```

### 7. Board Namespace (All-In-One)

```typescript
import { Board } from '@typecode';

Board.Serial.initialize({ baudRate: 115200 });
Board.LED.asOutput();

Board.Serial.println("Arduino Uno booted");
Board.Serial.println("MCU: " + Board.definition.mcu);
Board.Serial.println("Flash: " + Board.definition.memory.flash + " bytes");

while (true) {
  const sensor = Board.A0.read();
  Board.Serial.println(sensor);
  Board.LED.toggle();
}
```

## Peripheral Reference

### Serial (UART 0)

```typescript
import { Serial } from '@typecode';

Serial.initialize({ baudRate: 9600 });
Serial.println("Hello, World!");
Serial.print("Value: ");
Serial.println(42);
Serial.flush();   // wait for transmit buffer to empty
```

### I2C0 (Wire)

```typescript
import { I2C0, I2CSpeed } from '@typecode';

I2C0.initialize({ speed: I2CSpeed.FAST });  // 400 kHz

// Scan for devices
const devices = I2C0.scan();

// Register-level access
I2C0.writeByte(0x68, 0x6B, 0x00);           // wake MPU-6050
const whoAmI = I2C0.readByte(0x68, 0x75);    // read WHO_AM_I
```

### SPI0

```typescript
import { SPI0, SS } from '@typecode';

SPI0.initialize({ frequency: 4_000_000 });
SS.asOutput();

SS.low();
const rx = SPI0.transfer(new Uint8Array([0x80, 0x00]));
SS.high();
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