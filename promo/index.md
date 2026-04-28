# TypeHAL

**Write firmware in TypeScript. Ship it as C++.**

Type-safe, board-aware embedded development that catches hardware bugs before you flash — not after a 30-second upload cycle.

```bash
npx @typehal/create my-project --board arduino-uno
```

[Get Started →](quickstart.md) &nbsp;|&nbsp; [GitHub](https://github.com/typecad/typehal)

---

## Why TypeHAL?

Embedded firmware development has a feedback loop problem. You write C++, flash it to a board, and *then* discover you passed the wrong pin, forgot to initialize a bus, or used a pin that's already claimed by I2C. Every mistake costs a compile-flash-test cycle.

TypeHAL moves those checks into your editor.

---

## What makes it different

### 1. [Write TypeScript. Get C++.](typescript-to-cpp.md)

Full TypeScript syntax — classes, enums, destructuring, template literals, async/await, generics — lowers to lean, AVR-ready C++ with zero runtime overhead. No STL. No heap. Just idiomatic, readable output that fits in 2KB of RAM.

```typescript
import { LED, delay } from '@typehal';

async function blink() {
  const led = LED.asOutput();
  while (true) {
    led.toggle();
    await delay(1000);
  }
}

blink();
```

Emits clean `setup()` + `loop()` Arduino code. No boilerplate, no surprises.

[See how TypeScript lowers to C++ →](typescript-to-cpp.md)

---

### 2. [Hardware Bugs in Your Editor](hardware-safety.md)

Every pin has a narrow type that reflects what it can actually do on your board. Wrong pin for PWM? Red squiggle. Analog pin used as digital output? Error. I2C bus not initialized? Compile-time diagnostic.

```typescript
import { D4, D9, A0, I2C0 } from '@typehal';

D4.pwm(50);    // ❌ Error: D4 does not support PWM on Arduino Uno
D9.pwm(50);    // ✅ OK — D9 is a PWM pin

A0.high();     // ❌ Error: A0 is analog-only
A0.readAnalog(); // ✅ OK

I2C0.device(0x76).readByte(0xFA); // ❌ Error: I2C0 has not been initialized
```

These are not lint hints — they're type errors rooted in your board's actual pinmux data.

[See all board-aware diagnostics →](hardware-safety.md)

---

### 3. [Rust-Inspired Safety Model](ownership-and-safety.md)

Bus ownership, ISR-safety analysis, and peripheral conflict detection — all caught before you flash. Double-take on a bus, use a UART inside an ISR, accidentally share SPI pins with GPIO: all errors at transpile time.

```typescript
import { I2C0 } from '@typehal';

const bus = I2C0.take();  // exclusive ownership
bus.device(0x76).writeByte(0xFA, 0x55);
bus.release();

I2C0.take(); // ❌ Error: I2C0 already owned — release first
```

On Arduino the ownership tokens compile away to zero overhead. On ESP32 they map to mutex calls for real thread safety.

[See the ownership model →](ownership-and-safety.md)

---

### 4. [Test and Simulate Without Hardware](test-and-simulate.md)

Develop and validate firmware logic in Node.js before touching a board. When you're ready, run assertion tests on real hardware over serial with a single command.

```typescript
// Runs in Node.js — no board needed
import { createSimBoard } from '@typehal/simulator';
const board = createSimBoard();

// Runs on the actual microcontroller
import { describe, done } from '@typehal/expect';
import { A0 } from '@typehal';

describe("ADC").it("reads in valid range")
  .expect(A0.readAnalog()).toBeWithinRange(0, 1023);

done();
```

[See the test and simulate story →](test-and-simulate.md)

---

## One command to flash

```bash
npx typehal sketch.ts --compile --upload --monitor --port COM4
```

Transpile → compile → upload → open serial monitor. Or mix flags to fit your workflow.

---

## Supported boards

| Board | Package | Architecture |
|---|---|---|
| Arduino Uno | `@typehal/board-arduino-uno` | AVR |
| Arduino Nano 33 IoT | `@typehal/board-arduino-nano33iot` | SAMD |
| ESP32 DevKit | `@typehal/board-esp32-devkit` | ESP32 |

More architectures ready for board definitions: ESP32-S2/S3/C3, RP2040, STM32, nRF52.

---

## Ready to start?

```bash
npx @typehal/create my-project --board arduino-uno
cd my-project
npm install
npx typehal build --compile --upload --port COM4
```

[Full quickstart guide →](quickstart.md)
