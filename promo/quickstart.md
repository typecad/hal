# Quickstart

[← Home](index.md)

Get from zero to blinking LED — with TypeScript, type safety, and a single upload command.

---

## 1. Install

No global install needed. Scaffold a new project with `npx`:

```bash
npx @typecode/create my-project --board arduino-uno
cd my-project
npm install
```

This creates:

```
my-project/
  typecode.config.ts   ← board + output settings
  tsconfig.json        ← TypeScript project config
  typecode-env.d.ts    ← auto-generated: @typecode type definitions
  src/
    sketch.ts          ← your entry point
```

> **Other boards:** `--board esp32-devkit` or run `npx @typecode/create` with no flags for an interactive wizard.

---

## 2. Configure

`typecode.config.ts` is pre-populated for your board. For Arduino Uno it looks like:

```typescript
import type { TypecodeConfig } from '@typecode/core';

const config: TypecodeConfig = {
  target: 'avr',
  board:  '@typecode/board-arduino-uno',
  fqbn:   'arduino:avr:uno',
  output: {
    framework: 'arduino',
    optimize:  'size',
    outDir:    './out',
  },
};

export default config;
```

You don't need to touch this for a basic sketch.

---

## 3. Write your sketch

Replace the contents of `src/sketch.ts` with the blink demo:

```typescript
import { LED, delay } from '@typecode';

async function blink() {
  const led = LED.asOutput();

  while (true) {
    led.toggle();
    await delay(1000);
  }
}

blink();
```

**What this does, line by line:**

| Line | Meaning |
|---|---|
| `import { LED, delay } from '@typecode'` | Import board-specific pin and delay helpers |
| `LED.asOutput()` | Configure pin 13 as OUTPUT; returns a type-narrowed handle |
| `led.toggle()` | Emit `digitalWrite(13, !digitalRead(13))` |
| `await delay(1000)` | `await` is stripped at transpile — emits `delay(1000)` |
| `blink()` | Entry call; folds into Arduino's `setup()` + `loop()` |

The emitted C++ is clean idiomatic Arduino:

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

## 4. Transpile

```bash
npx typecode build
```

Output goes to `./out/sketch/sketch.ino`. Open it to inspect the generated code.

---

## 5. Compile and upload

Connect your Arduino Uno and find the port (`COM4` on Windows, `/dev/ttyUSB0` on Linux/macOS):

```bash
npx typecode build --compile --upload --port COM4
```

To also open a serial monitor after upload:

```bash
npx typecode build --compile --upload --monitor --port COM4
```

The LED on pin 13 will start blinking at 1-second intervals.

---

## 6. Try a hardware diagnostic

Edit `src/sketch.ts` to trigger a type error:

```typescript
import { D4, delay } from '@typecode';

// D4 does not support PWM on Arduino Uno
D4.pwm(50); // ← red squiggle in VS Code
```

VS Code underlines `D4.pwm(50)` immediately. The transpiler also exits with a diagnostic:

```
[ERROR] TS2CPP_PIN_CAPABILITY  D4 does not support PWM on Arduino Uno  src/sketch.ts:4:1
```

Undo the change and swap in `D9` — a real PWM pin — to see it compile cleanly.

---

## API overview

### GPIO pins

```typescript
import { D2, D9, A0, LED } from '@typecode';

// Output
LED.asOutput();          // configure as output
LED.asOutput(HIGH);      // configure and set initial state
LED.toggle();            // invert current state
LED.high();              // set HIGH
LED.low();               // set LOW
LED.output(HIGH);        // alias for .high() / .low()

// Input
D2.asInput();            // configure as input
D2.asInputPullUp();      // configure with internal pull-up
D2.read();               // returns bool
D2.readAnalog();         // returns 0–1023 (analog-capable pins only)

// PWM (PWM-capable pins only)
D9.asOutput();
D9.pwm(50);              // duty cycle 0–100%

// Interrupts (interrupt-capable pins only)
D2.onChange(() => { });  // rising + falling
D2.onRising(() => { });
D2.onFalling(() => { });
```

### Timing

```typescript
import { delay, millis, micros } from '@typecode';

delay(1000);             // block for 1000 ms
const t = millis();      // ms since boot (unsigned long)
const u = micros();      // µs since boot (unsigned long)
```

### I2C

```typescript
import { I2C0 } from '@typecode';

const bus = I2C0.begin();           // initialize as master (default 100 kHz)
I2C0.begin(400000);                 // fast mode

const dev = bus.device(0x76);      // get a device handle

dev.writeByte(0xFA, 0x55);         // write single byte to register
dev.readByte(0xFA);                // read single byte from register
dev.readBytes(0xFA, 4);            // read n bytes → Uint8Array
dev.writeBytes(0xFA, [0x01, 0x02]); // write byte array

// Ownership model (opt-in)
const owned = I2C0.take();
if (owned) {
  owned.device(0x76).writeByte(0xFA, 0x55);
  owned.release();
}
```

### SPI

```typescript
import { SPI0 } from '@typecode';

SPI0.begin();
SPI0.beginTransaction({ frequency: 4000000, mode: 0, bitOrder: 'msb' });
SPI0.transfer(0xAB);               // transfer one byte, returns received byte
SPI0.endTransaction();
```

### UART / Serial

```typescript
import { UART0 } from '@typecode';

const serial = UART0.begin(9600);

serial.print("hello");
serial.println("world");
serial.println(42);
serial.println(3.14);
serial.available();                // bytes available to read
serial.read();                     // read one byte
serial.flush();                    // wait for TX buffer to drain
```

### Pin type guards

```typescript
import { isPWMPin, isAnalogPin, isInterruptPin, assertPWM } from '@typecode/core';
import type { PWMPin, AnalogPin, InterruptPin } from '@typecode/core';

isPWMPin(pin)        // narrows to PWMPin
isAnalogPin(pin)     // narrows to AnalogPin
isInterruptPin(pin)  // narrows to InterruptPin

assertPWM(pin, 'message')  // throws diagnostic if not PWM
```

### Hardware expect (testing)

```typescript
import { describe, done } from '@typecode/expect';
import { A0 } from '@typecode';

describe("ADC")
  .it("reads in valid range")
    .expect(A0.readAnalog()).toBeWithinRange(0, 1023);

done();
```

Run: `npx typecode-test --port COM4 tests/sketch.test.ts`

### Simulator

```typescript
import { createSimBoard } from '@typecode/simulator';

const board = createSimBoard();
board.i2c.addDevice(0x76, { readByte: (reg) => 0x60 });
```

---

## CLI reference

```bash
# Scaffold a new project
npx @typecode/create [project-name] --board arduino-uno

# Build (transpile only)
npx typecode build

# Build + compile
npx typecode build --compile

# Build + compile + upload
npx typecode build --compile --upload --port COM4

# Build + compile + upload + serial monitor
npx typecode build --compile --upload --monitor --port COM4

# Single file (no config)
npx typecode src/sketch.ts --compile --upload --port COM4

# Map a compiler error back to TypeScript
npx typecode map-error out/sketch/sketch.ino.tscppmap.json --line 42 --col 5

# Scaffold a new board package
npx typecode create-board my-board
```

---

## Project structure (after scaffold)

```
my-project/
  typecode.config.ts     ← board, target, output settings
  tsconfig.json          ← TypeScript project config
  typecode-env.d.ts      ← auto-generated @typecode type definitions
  package.json
  src/
    sketch.ts            ← your firmware entry point
  out/
    sketch/
      sketch.ino         ← generated Arduino sketch
      sketch.ino.tscppmap.json  ← source map
```

---

## Next steps

- [TypeScript to C++ — what gets emitted](typescript-to-cpp.md)
- [Board-aware hardware diagnostics](hardware-safety.md)
- [Bus ownership and ISR safety](ownership-and-safety.md)
- [Testing and simulation](test-and-simulate.md)
