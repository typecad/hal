# TypeCode Language Reference

TypeCode is a TypeScript-based hardware description language that transpiles to C++ for embedded systems. It provides type-safe abstractions for GPIO pins, buses (I2C, SPI, UART), and Arduino-style programming while generating efficient C++ code.

## Table of Contents

- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [Pin System](#pin-system)
- [Peripherals](#peripherals)
- [Control Flow](#control-flow)
- [Functions](#functions)
- [Classes and Enums](#classes-and-enums)
- [Type System](#type-system)
- [Memory Management](#memory-management)
- [Concurrency](#concurrency)
- [Polyfills](#polyfills)
- [Board Packages](#board-packages)
- [CLI Commands](#cli-commands)

---

## Quick Start

```typescript
// Import board-specific pins and timing
import { LED }   from '@typecode/board-arduino-uno/pins';
import { delay } from '@typecode/board-arduino-uno/timing';

// Configure and run
LED.asOutput();

while (true) {
  LED.toggle();
  delay(1000);
}
```

Transpiles to Arduino C++:
```cpp
#include <Arduino.h>

void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, !digitalRead(13));
  delay(1000);
}
```

---

## Core Concepts

### Type-Safe Hardware Abstraction

TypeCode's unique feature is **compile-time pin capability checking**. Each pin has a specific interface that defines what operations are valid:

```typescript
import { D2, D4, D9 } from '@typecode/board-arduino-uno/pins';

// D2 is IDigitalPin & IInterruptPin - valid
D2.attachInterrupt(() => {}, InterruptMode.FALLING);

// D4 is IDigitalPin only - compile error!
// D4.attachInterrupt(() => {}, InterruptMode.FALLING); // ❌

// D9 is IPWMPin - PWM operations valid
D9.write(128);  // ✅ 8-bit PWM duty cycle
```

### Import Resolution

Imports map to C++ headers via `*.libdef.json` files:

```json
{
  "module": "wire",
  "include": "<Wire.h>",
  "symbols": { "Wire": "Wire" }
}
```

### Tree-Shaking

Dead code elimination removes unreachable functions, classes, and enums:

```bash
# Default: tree-shaking enabled
npm run transpile -- input.ts

# Disable tree-shaking
npm run transpile -- input.ts --no-tree-shake

# Keep unused enums/classes
npm run transpile -- input.ts --keep-unused-enums --keep-unused-classes
```

---

## Pin System

### Pin Type Hierarchy

```
IPin (base)
├── IDigitalInput
│   └── read(), isHigh(), isLow(), waitForRising(), waitForFalling()
├── IDigitalOutput
│   └── write(), high(), low(), toggle(), pulse()
├── IDigitalPin (combines Input + Output)
│   └── asInput(), asOutput(), asInputPullUp(), asInputPullDown()
├── IPWMPin (extends IDigitalPin)
│   └── write(), setFrequency(), setDutyCycle(), attach(), detach()
├── IAnalogInput
│   └── read(), readVoltage(), setReference(), getResolution()
├── IInterruptPin
│   └── attachInterrupt(), detachInterrupt(), hasInterrupt()
├── ITouchPin (ESP32)
│   └── read(), setThreshold(), attachTouchInterrupt()
├── IADCPin (extends IAnalogInput)
│   └── setAttenuation(), startContinuousSampling(), readAveraged()
└── IDACPin
    └── outputSine(), stopOutput(), setChannel()
```

### Digital Pin Example

```typescript
import { D2, LED } from '@typecode/board-arduino-uno/pins';

// Configure pins
LED.asOutput();
D2.asInputPullUp();

// Read and write
const buttonState = D2.read();
if (buttonState) {
  LED.high();
} else {
  LED.low();
}

// Toggle and pulse
LED.toggle();
LED.pulse(100);  // 100ms pulse
```

### PWM Pin Example

```typescript
import { D9 } from '@typecode/board-arduino-uno/pins';

D9.asOutput();

// Write PWM value (0-255 on AVR)
D9.write(128);

// Configure frequency and duty cycle
D9.setFrequency(1000);    // 1kHz
D9.setDutyCycle(0.5);     // 50%
```

### Analog Input Example

```typescript
import { A0 } from '@typecode/board-arduino-uno/pins';

// Read raw ADC value (0-1023 on 10-bit ADC)
const rawValue = A0.read();

// Read as voltage (requires reference setting)
const voltage = A0.readVoltage();
```

### Interrupt Example

```typescript
import { D2, LED } from '@typecode/board-arduino-uno/pins';
import { InterruptMode } from '@typecode/core';

LED.asOutput();
D2.asInputPullUp();

let ledState = false;

D2.attachInterrupt(() => {
  ledState = !ledState;
  if (ledState) {
    LED.high();
  } else {
    LED.low();
  }
}, InterruptMode.FALLING);

// Later: D2.detachInterrupt();
```

### Pin Modes

```typescript
enum PinMode {
  INPUT             = 'INPUT',
  OUTPUT            = 'OUTPUT',
  INPUT_PULLUP      = 'INPUT_PULLUP',
  INPUT_PULLDOWN    = 'INPUT_PULLDOWN',
  OUTPUT_OPEN_DRAIN = 'OUTPUT_OPEN_DRAIN',
  ANALOG            = 'ANALOG',
}
```

### Interrupt Modes

```typescript
enum InterruptMode {
  RISING  = 'RISING',
  FALLING = 'FALLING',
  CHANGE  = 'CHANGE',
  LOW     = 'LOW',
  HIGH    = 'HIGH',
}
```

---

## Peripherals

### Serial (UART)

```typescript
import { Serial } from '@typecode/board-arduino-uno/peripherals';

Serial.initialize({ baudRate: 9600 });

Serial.println("Hello, World!");
Serial.print("Value: ");
Serial.println(42);

// Read incoming data
if (Serial.available() > 0) {
  const data = Serial.read();
}
```

### I2C Bus

```typescript
import { I2C0 } from '@typecode/board-arduino-uno/peripherals';

// Initialize with config
I2C0.initialize({ speed: 100000 });  // 100kHz standard mode

const DEVICE_ADDR = 0x76;

// Scan bus for devices
const found = I2C0.scan();

// Ping specific device
if (I2C0.ping(DEVICE_ADDR)) {
  // Read register
  const tempRaw = I2C0.readWord(DEVICE_ADDR, 0xFA);
  
  // Write register
  I2C0.writeByte(DEVICE_ADDR, 0xF4, 0x2E);
}

// Raw transfers
I2C0.write(DEVICE_ADDR, new Uint8Array([0xF4, 0x2E]));
const response = I2C0.read(DEVICE_ADDR, 6);

// Combined write-then-read
const data = I2C0.writeThenRead(DEVICE_ADDR, 
  new Uint8Array([0xFA]),  // register to read from
  6                        // bytes to read
);
```

#### I2C Speed Presets

```typescript
enum I2CSpeed {
  STANDARD   = 100_000,
  FAST       = 400_000,
  FAST_PLUS  = 1_000_000,
  HIGH_SPEED = 3_400_000,
}
```

### SPI Bus

```typescript
import { SPI0 } from '@typecode/board-arduino-uno/peripherals';
import { SS }   from '@typecode/board-arduino-uno/pins';

SPI0.initialize({ 
  frequency: 1_000_000,  // 1MHz
  mode: SPIMode.MODE_0 
});

SS.asOutput();

// Write data
SS.low();
SPI0.write(new Uint8Array([0xAA, 0x55]));
SS.high();

// Full-duplex transfer
SS.low();
const response = SPI0.transfer(new Uint8Array([0x03, 0x00, 0x00]));
SS.high();

// Register read/write
const value = SPI0.readRegister(SS.number, 0x0F, 2);
SPI0.writeRegister(SS.number, 0x20, new Uint8Array([0x40]));
```

#### SPI Configuration

```typescript
enum SPIMode {
  MODE_0 = 0,  // CPOL=0, CPHA=0
  MODE_1 = 1,  // CPOL=0, CPHA=1
  MODE_2 = 2,  // CPOL=1, CPHA=0
  MODE_3 = 3,  // CPOL=1, CPHA=1
}

enum SPIClockPolarity {
  LOW  = 0,
  HIGH = 1,
}

enum SPIClockPhase {
  LEADING  = 0,
  TRAILING = 1,
}

enum SPIBitOrder {
  MSB = 0,
  LSB = 1,
}
```

---

## Control Flow

### If/Else

```typescript
const value = A0.read();

if (value > 512) {
  LED.high();
} else if (value > 256) {
  D9.write(128);
} else {
  LED.low();
}
```

### While Loop

```typescript
let count = 0;

while (count < 10) {
  Serial.println(count);
  count++;
  delay(100);
}

// Infinite loop (common in embedded)
while (true) {
  LED.toggle();
  delay(500);
}
```

### Do-While Loop

```typescript
let value = 0;

do {
  value = A0.read();
  delay(10);
} while (value < 100);
```

### For Loop

```typescript
// Standard C-style for loop
for (let i = 0; i < 10; i++) {
  Serial.println(i);
}

// With step
for (let i = 100; i >= 0; i -= 10) {
  D9.write(i);
  delay(50);
}
```

### For-Of Loop (Range-Based)

```typescript
const values = [10, 20, 30, 40, 50];

for (const val of values) {
  Serial.println(val);
}
```

### Switch Statement

```typescript
const mode = D2.read() ? 1 : 0;

switch (mode) {
  case 0:
    LED.low();
    break;
  case 1:
    LED.high();
    break;
  default:
    LED.toggle();
    break;
}
```

### Break and Continue

```typescript
// Break out of loop
for (let i = 0; i < 100; i++) {
  if (i == 50) break;
  Serial.println(i);
}

// Skip iteration
for (let i = 0; i < 10; i++) {
  if (i % 2 == 0) continue;
  Serial.println(i);  // Only prints odd numbers
}
```

### Try/Catch/Throw

```typescript
function riskyOperation(): int {
  const value = A0.read();
  if (value < 0) {
    throw "Invalid ADC reading";
  }
  return value;
}

try {
  const result = riskyOperation();
  Serial.println(result);
} catch (e) {
  Serial.println("Error occurred");
}
```

---

## Functions

### Function Declarations

```typescript
// Basic function
function greet(): void {
  Serial.println("Hello!");
}

// With parameters
function add(a: int, b: int): int {
  return a + b;
}

// With default parameters
function greetName(name: string = "World"): void {
  Serial.println("Hello, " + name);
}

// Multiple return paths
function clamp(value: int, min: int, max: int): int {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
```

### Async Functions (State Machine)

TypeCode transforms async functions into cooperative state machines:

```typescript
async function blinkLed() {
  while (true) {
    LED.high();
    await delay(500);
    LED.low();
    await delay(500);
  }
}
```

Generates C++ state machine:
```cpp
class BlinkLedTask {
public:
  enum State { START, WAIT1, WAIT2 };
  
  void run() {
    switch (state) {
      case START:
        digitalWrite(13, HIGH);
        waitUntil = millis() + 500;
        state = WAIT1;
        break;
      case WAIT1:
        if (millis() >= waitUntil) {
          digitalWrite(13, LOW);
          waitUntil = millis() + 500;
          state = WAIT2;
        }
        break;
      case WAIT2:
        if (millis() >= waitUntil) {
          state = START;
        }
        break;
    }
  }
  
private:
  State state = START;
  unsigned long waitUntil = 0;
};
```

---

## Classes and Enums

### Class Declaration

```typescript
class Motor {
  private pin: IPWMPin;
  private speed: int = 0;
  
  public constructor(pin: IPWMPin) {
    this.pin = pin;
    this.pin.asOutput();
  }
  
  public setSpeed(speed: int): void {
    this.speed = clamp(speed, 0, 255);
    this.pin.write(this.speed);
  }
  
  public getSpeed(): int {
    return this.speed;
  }
  
  public stop(): void {
    this.speed = 0;
    this.pin.write(0);
  }
}

// Usage
const motor = new Motor(D9);
motor.setSpeed(128);
```

### Enum Declaration

```typescript
enum State {
  IDLE,
  RUNNING,
  PAUSED,
  ERROR = -1,
}

let currentState = State.IDLE;

switch (currentState) {
  case State.IDLE:
    // ...
    break;
  case State.RUNNING:
    // ...
    break;
}
```

---

## Type System

### Supported Types

| TypeScript | C++ | Notes |
|------------|-----|-------|
| `number` (integer literal) | `int` | Inferred from `10`, `0xFF`, etc. |
| `number` (float literal) | `float` | Inferred from `3.14`, `1e-3` |
| `boolean` | `bool` | `true`/`false` |
| `string` | `auto` | Warning emitted; needs proper type |
| `void` | `void` | No return value |
| Explicit `: int` | `int` | Override inference |
| Explicit `: float` | `float` | Override inference |
| Explicit `: bool` | `bool` | Override inference |

### Type Annotations

```typescript
// Explicit types
const count: int = 10;
const pi: float = 3.14159;
const flag: bool = true;

// Inferred types
const count = 10;      // int
const pi = 3.14159;    // float
const flag = true;     // bool
```

### Type Assertions

```typescript
const value = someValue as int;
const bytes = buffer as Uint8Array;
```

---

## Memory Management

### Fixed Buffer

Stack-allocated buffer with push/pop:

```typescript
const buffer: FixedBuffer<int> = createFixedBuffer<int>(32);

buffer.push(10);
buffer.push(20);
const value = buffer.pop();  // 20
const len = buffer.length;   // 1
```

### Circular Buffer

Ring buffer for streaming data:

```typescript
const rxBuffer: CircularBuffer<int> = createCircularBuffer<int>(64);

// In interrupt handler
rxBuffer.write(incomingByte);

// In main loop
if (!rxBuffer.isEmpty()) {
  const data = rxBuffer.read();
}
```

### Object Pool

Pre-allocated pool for O(1) allocation:

```typescript
interface SensorReading {
  timestamp: int;
  value: float;
}

const pool: ObjectPool<SensorReading> = createObjectPool<SensorReading>(16);

// Acquire from pool
const reading = pool.acquire();
if (reading) {
  reading.timestamp = millis();
  reading.value = A0.read();
  // Use reading...
  pool.release(reading);
}
```

---

## Concurrency

### Task Management

```typescript
import { TaskManager, TaskPriority, TaskState } from '@typecode/core';

const tasks = new TaskManager();

// Create one-shot task
const handle = tasks.create({
  name: "sensor-read",
  priority: TaskPriority.NORMAL,
  run: async () => {
    const value = A0.read();
    Serial.println(value);
  }
});

// Create periodic task
tasks.createPeriodic("blink", () => {
  LED.toggle();
}, 1000);  // every 1000ms

// Task control
handle.suspend();
handle.resume();
handle.terminate();

// Query state
const stats = handle.getStats();
Serial.println(stats.runCount);
```

### Lock (Mutex)

```typescript
import { Lock } from '@typecode/core';

const i2cLock = new Lock();

async function readSensor(): Promise<int> {
  await i2cLock.acquire();
  try {
    const value = I2C0.readByte(0x76, 0x00);
    return value;
  } finally {
    i2cLock.release();
  }
}
```

---

## Polyfills

TypeCode provides automatic polyfills for common TypeScript patterns:

### Console Output

| TypeScript | Generic C++ | Arduino |
|------------|-------------|---------|
| `console.log(msg)` | `std::cout << msg << std::endl` | `Serial.println(msg)` |
| `console.error(msg)` | `std::cerr << "[ERROR] " << msg` | `Serial.print("[ERROR]"); Serial.println(msg)` |
| `console.warn(msg)` | `std::cerr << "[WARN] " << msg` | `Serial.print("[WARN]"); Serial.println(msg)` |

```typescript
console.log("Hello");
console.log(42);
console.log(3.14);
```

### Array Methods

| TypeScript | std::vector | StaticArray (AVR) |
|------------|-------------|-------------------|
| `arr.push(x)` | `arr.push_back(x)` | `arr.push_back(x)` |
| `arr.pop()` | `arr.pop_back()` | `arr.pop_back()` |
| `arr.length` | `arr.size()` | `arr.size()` |

### String Methods

| TypeScript | std::string | StaticString (AVR) |
|------------|-------------|-------------------|
| `s.toUpperCase()` | `std::transform` | `s.toUpperCase()` |
| `s.includes(sub)` | `s.find() != npos` | `s.includes(sub)` |
| `s.startsWith(pre)` | `s.rfind(pre, 0) == 0` | `s.startsWith(pre)` |
| `s.trim()` | `find_first_not_of` pattern | `s.trim()` |

### Architecture Support Matrix

| Feature | AVR | ESP32 | RP2040 | Generic |
|---------|-----|-------|--------|---------|
| `std::vector` | ❌ | ✅ | ✅ | ✅ |
| `std::string` | ❌ | ✅ | ✅ | ✅ |
| `<iostream>` | ❌ | ✅ | ✅ | ✅ |
| RTTI | ❌ | ✅ | ✅ | ✅ |
| Exceptions | ❌ | ✅ | ✅ | ✅ |
| `StaticArray` | ✅ | ✅ | ✅ | ✅ |
| `StaticString` | ✅ | ✅ | ✅ | ✅ |

---

## Board Packages

### Board Namespace

Single import for all board features:

```typescript
import { Board } from '@typecode/board-arduino-uno/board';

// Access pins
Board.LED.asOutput();
Board.D9.write(128);
Board.A0.read();

// Access peripherals
Board.Serial.initialize({ baudRate: 115200 });
Board.I2C0.initialize();
Board.SPI0.initialize({ frequency: 1_000_000 });

// Board metadata
Board.Serial.println("MCU: " + Board.definition.mcu);
Board.Serial.println("Flash: " + Board.definition.memory.flash + " bytes");

// Pin collections
for (const pin of Board.digital) {
  // Access digital pins
}
```

### Available Board Packages

| Package | Board |
|---------|-------|
| `@typecode/board-arduino-uno` | Arduino Uno (AVR) |
| `@typecode/board-arduino-nano33iot` | Arduino Nano 33 IoT (SAMD) |
| `@typecode/board-esp32-devkit` | ESP32 DevKit |

### Creating Custom Board Packages

```typescript
// src/board.ts
import type { IDigitalPin, IPWMPin, IAnalogInput } from '@typecode/core';

export interface IMyBoard {
  readonly LED: IDigitalPin;
  readonly D2: IDigitalPin;
  readonly D9: IPWMPin;
  readonly A0: IAnalogInput;
}

export const Board: IMyBoard = {
  LED: createDigitalPin(13),
  D2: createDigitalPin(2),
  D9: createPWMPin(9),
  A0: createAnalogPin(14),
};
```

---

## CLI Commands

### Transpile

```bash
# Basic transpile
npm run transpile -- input.ts

# With options
npm run transpile -- input.ts \
  --emit split \
  --target arduino \
  --arduino-arch avr \
  --fqbn arduino:avr:uno \
  --out-dir ./output \
  --compile-arduino true
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--emit` | `split` | `cpp` (single file) or `split` (`.h` + `.cpp`) |
| `--target` | `generic` | `generic` or `arduino` |
| `--out-dir` | - | Output directory |
| `--arduino-arch` | - | Architecture: `avr`, `esp32`, `samd`, `rp2040` |
| `--fqbn` | - | Fully Qualified Board Name |
| `--compile-arduino` | `false` | Run `arduino-cli compile` after transpile |
| `--emit-maps` | `true` | Generate source maps |

### Tree-Shaking Options

| Option | Description |
|--------|-------------|
| `--no-tree-shake` | Disable tree-shaking |
| `--keep-unused-enums` | Keep all enums |
| `--keep-unused-classes` | Keep all classes |
| `--keep-unused-types` | Keep all type aliases |
| `--no-report-unused` | Don't warn about removed code |
| `--entry-point <name>` | Add custom entry point (can repeat) |

### Generate Library Definitions

```bash
npm run gen-libdefs -- input.ts
```

Creates `<module>.libdef.json` for import resolution.

### Generate Type Declarations

```bash
npm run gen-types -- --arduino-arch avr --outDir ./src
```

Generates `arduino.d.ts` for editor IntelliSense.

### Map Errors

```bash
npm run map-error -- output.tscppmap.json --line 42 --column 10
```

Maps C++ compiler errors back to TypeScript source locations.

---

## Unique Features Summary

### 1. **Compile-Time Pin Capability Checking**
Pins are typed with their capabilities. Using an interrupt on a non-interrupt pin is a compile error, not a runtime failure.

### 2. **Architecture-Aware Code Generation**
The transpiler automatically selects appropriate C++ constructs based on target architecture (e.g., `StaticArray` for AVR, `std::vector` for ESP32).

### 3. **Async/Await State Machines**
TypeScript async functions transform into cooperative C++ state machines suitable for embedded systems without an RTOS.

### 4. **Tree-Shaking for Embedded**
Dead code elimination reduces binary size by removing unused functions, classes, and enums.

### 5. **Source Map Error Mapping**
C++ compiler errors map back to TypeScript source locations for easier debugging.

### 6. **Declaration-First Library Integration**
Import C++ libraries via `*.libdef.json` without transpiling their source.

### 7. **Fixed-Capacity Memory Types**
Stack-allocated buffers prevent heap fragmentation on long-running embedded systems.

### 8. **Board Package System**
Swap between Arduino Uno, ESP32, and other boards by changing a single import.