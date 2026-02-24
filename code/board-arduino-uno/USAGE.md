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
import { D13, A0 }        from './code/board-arduino-uno/pins';
import { Serial }         from './code/board-arduino-uno/peripherals';
import { delay, millis }  from './code/board-arduino-uno/timing';
```

### Style 2: Unified `Board` namespace

```typescript
import { Board } from './code/board-arduino-uno/board';

Board.D13.high();
Board.Serial.println("Hello");
```

### Style 3: Barrel import (everything)

```typescript
import {
  D13, A0, LED, Serial, delay, millis,
  I2C0, SPI0, Board,
} from './code/board-arduino-uno';
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
D4.asOutput();
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
import { LED } from './code/board-arduino-uno/pins';
import { delay }  from './code/board-arduino-uno/timing';

LED.asOutput();

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
import { A0 }     from './code/board-arduino-uno/pins';
import { Serial }  from './code/board-arduino-uno/peripherals';
import { delay }   from './code/board-arduino-uno/timing';

Serial.initialize({ baudRate: 9600 });

while (true) {
  const value = A0.read();
  Serial.println(value);
  delay(500);
}
```

---

### 3. PWM Fade

```typescript
// examples/03-pwm-fade.ts
import { D9 }    from './code/board-arduino-uno/pins';
import { delay }  from './code/board-arduino-uno/timing';

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

### 4. External Interrupt (Button)

```typescript
// examples/04-interrupt.ts
import { D2, LED } from './code/board-arduino-uno/pins';
import { InterruptMode } from './code/core';

LED.asOutput();
D2.asInputPullUp();

let ledState = false;

D2.attachInterrupt(() => {
  ledState = !ledState;
  if (ledState) { LED.high(); } else { LED.low(); }
}, InterruptMode.FALLING);
```

---

### 5. I2C — Read From a Sensor

```typescript
// examples/05-i2c-sensor.ts
import { I2C0 }   from './code/board-arduino-uno/peripherals';
import { Serial }  from './code/board-arduino-uno/peripherals';
import { delay }   from './code/board-arduino-uno/timing';

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

---

### 6. SPI — Write to a Shift Register

```typescript
// examples/06-spi-shift-register.ts
import { SPI0, Serial } from './code/board-arduino-uno/peripherals';
import { SS }            from './code/board-arduino-uno/pins';
import { delay }         from './code/board-arduino-uno/timing';

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

---

### 7. Board Namespace (All-In-One)

```typescript
// examples/07-board-namespace.ts
import { Board } from './code/board-arduino-uno/board';

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

---

## Peripheral Reference

### Serial (UART 0)

```typescript
import { Serial } from './code/board-arduino-uno/peripherals';

Serial.initialize({ baudRate: 9600 });
Serial.println("Hello, World!");
Serial.print("Value: ");
Serial.println(42);
Serial.flush();   // wait for transmit buffer to empty
```

### I2C0 (Wire)

```typescript
import { I2C0 } from './code/board-arduino-uno/peripherals';
import { I2CSpeed } from './code/core';

I2C0.initialize({ speed: I2CSpeed.FAST });  // 400 kHz

// Scan for devices
const devices = I2C0.scan();

// Register-level access
I2C0.writeByte(0x68, 0x6B, 0x00);           // wake MPU-6050
const whoAmI = I2C0.readByte(0x68, 0x75);    // read WHO_AM_I
```

### SPI0

```typescript
import { SPI0 } from './code/board-arduino-uno/peripherals';
import { SS }   from './code/board-arduino-uno/pins';

SPI0.initialize({ frequency: 4_000_000 });
SS.asOutput();

SS.low();
const rx = SPI0.transfer(new Uint8Array([0x80, 0x00]));
SS.high();
```

---

## Timing Functions

```typescript
import { delay, millis, micros, delayMicroseconds } from './code/board-arduino-uno/timing';

delay(1000);             // block 1 second
delayMicroseconds(10);   // block 10 µs

const t = millis();      // ms since reset
const us = micros();     // µs since reset
```

---

## Utility Functions

```typescript
import { map, constrain } from './code/board-arduino-uno/timing';

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
import { ArduinoUno } from './code/board-arduino-uno';

console.log(ArduinoUno.name);             // "Arduino Uno"
console.log(ArduinoUno.mcu);              // "ATmega328P"
console.log(ArduinoUno.clockSpeed);       // 16000000
console.log(ArduinoUno.memory.flash);     // 32768
console.log(ArduinoUno.memory.sram);      // 2048
console.log(ArduinoUno.memory.eeprom);    // 1024
console.log(ArduinoUno.pins.pwm);         // ["D3","D5","D6","D9","D10","D11"]
console.log(ArduinoUno.features.watchdog);// true
console.log(ArduinoUno.build.arduino);    // "arduino:avr:uno"
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
