# Adding a New Board

This guide walks through everything required to add support for a new
microcontroller board.  The Arduino Uno package
(`code/board-arduino-uno/`) is used as the reference throughout.

---

## Table of Contents

1. [Overview](#overview)
2. [Directory structure](#directory-structure)
3. [Step 1 — Board manifest (`index.ts`)](#step-1--board-manifest-indexts)
4. [Step 2 — Pin stubs (`pins.ts`)](#step-2--pin-stubs-pinsts)
5. [Step 3 — Peripheral stubs (`peripherals.ts`)](#step-3--peripheral-stubs-peripheralsts)
6. [Step 4 — Timing helpers (`timing.ts`)](#step-4--timing-helpers-timingts)
7. [Step 5 — Interrupt helpers (`interrupts.ts`)](#step-5--interrupt-helpers-interruptsts)
8. [Step 6 — Board namespace (`board.ts`)](#step-6--board-namespace-boardts)
9. [Step 7 — Register pin names in the compiler](#step-7--register-pin-names-in-the-compiler)
10. [Step 8 — Verify constant folding](#step-8--verify-constant-folding)
11. [Step 9 — Test the board](#step-9--test-the-board)
12. [Reference: `BoardDefinition` shape](#reference-boarddefinition-shape)
13. [Reference: `PinCapabilityFlags`](#reference-pincapabilityflags)

---

## Overview

A board package is a directory under `code/` named `board-<id>/`.  It
provides two things:

- **Type-level design-time API** — TypeScript interfaces and stub objects
  that give IDE autocomplete, type-checking, and compile-time errors when
  user code calls a method on the wrong kind of pin.
- **Machine-readable manifest** — an `export const <Name>: BoardDefinition`
  object literal that the compiler parses at transpile time to fold
  `Board.definition.*` accesses into inline C++ constants.

The compiler discovers a board package by scanning the source file's
`import` statements.  Any relative import that resolves to a path matching
`/code/board-*/` is treated as a board SDK import; from there the
`index.ts` in that directory is parsed to extract `BoardDefinition` constants.

---

## Directory structure

```
code/
└── board-<your-board-id>/
    ├── index.ts          ← manifest + barrel re-exports   (required)
    ├── pins.ts           ← typed pin stub exports         (required)
    ├── peripherals.ts    ← typed peripheral stub exports  (required)
    ├── timing.ts         ← declare functions for timing   (required)
    ├── interrupts.ts     ← declare functions for ISRs     (required)
    ├── board.ts          ← Board namespace facade         (recommended)
    └── analog.ts         ← analog reference helpers       (optional)
```

The directory name **must** start with `board-`.  The compiler uses the
path pattern `/code/board-/` to detect board packages.

---

## Step 1 — Board manifest (`index.ts`)

`index.ts` is the most important file.  It exports the `BoardDefinition`
object that the compiler reads to fold `Board.definition.*` accesses.

### Rules the compiler relies on

- The exported `const` must be an **object literal** directly (not a
  function call or `Object.assign`).  The compiler walks the AST of this
  file using `ts.createProgram` and extracts scalar leaf values.
- Supported value types: `string`, `number` (including `_` separators
  like `32_768`), `true`/`false`, and negative numbers (`-1`).
- Nested sub-objects are resolved recursively and flattened to dot-path
  keys (e.g. `memory.flash`).
- Arrays (like `pins.all`) are ignored by the resolver — they are not
  needed for constant folding.

### Template

```typescript
// code/board-<id>/index.ts
import type { BoardDefinition } from '../core';

// --- Capability shorthand constants (optional but recommended) -----------

const NO  = false as const;
const YES = true  as const;

const DIGITAL = {
  digitalInput: YES, digitalOutput: YES,
  analogInput: NO,   analogOutput: NO,
  pwm: NO,           interrupt: NO,
  pullUp: YES,       pullDown: NO,
  touch: NO,         openDrain: NO,
} as const;

// ... add more capability shorthands as needed

// --- Manifest -----------------------------------------------------------

export const MyBoard: BoardDefinition = {
  // ---- Identity --------------------------------------------------------
  id:          'my-board-id',      // must be unique, lowercase kebab-case
  name:        'My Board Name',
  vendor:      'Vendor Name',
  description: 'Short description — MCU name',
  architecture: 'avr',             // 'avr' | 'arm' | 'xtensa' | 'riscv' | ...
  mcu:         'ATmega2560',

  // ---- Clock -----------------------------------------------------------
  clockSpeed: 16_000_000,          // Hz

  // ---- Memory ----------------------------------------------------------
  memory: {
    flash:  253_952,               // bytes (program storage)
    sram:    8_192,                // bytes (dynamic memory)
    eeprom:  4_096,                // bytes (0 if not present)
  },

  // ---- Pins ------------------------------------------------------------
  pins: {
    all: [
      // One entry per physical pin.  See reference section below.
      { number: 0, gpio: 0, name: 'D0', capabilities: DIGITAL },
      // ...
    ],
    digital: ['D0', 'D1', /* ... */],
    analog:  ['A0', 'A1', /* ... */],
    pwm:     ['D2', 'D3', /* ... */],

    i2c:  { 0: { sda: 'D20', scl: 'D21' } },
    spi:  { 0: { mosi: 'D51', miso: 'D50', sck: 'D52', cs: 'D53' } },
    uart: {
      0: { tx: 'D1',  rx: 'D0'  },
      1: { tx: 'D18', rx: 'D19' },
    },
    led: 'D13',
  },

  // ---- Peripherals -----------------------------------------------------
  peripherals: {
    i2c:  [{ instance: 0, defaultPins: { sda: 'D20', scl: 'D21' } }],
    spi:  [{ instance: 0, defaultPins: { mosi: 'D51', miso: 'D50', sck: 'D52', cs: 'D53' } }],
    uart: [
      { instance: 0, defaultPins: { tx: 'D1',  rx: 'D0'  } },
      { instance: 1, defaultPins: { tx: 'D18', rx: 'D19' } },
    ],
    adc:  [{ instance: 0, channels: 16, resolution: 10, referenceVoltage: 5.0 }],
    pwm:  { channels: 15, resolution: 8, maxFrequency: 62_500 },
  },

  // ---- Features --------------------------------------------------------
  features: {
    multicore:          false,
    coreCount:          1,
    deepSleep:          false,
    watchdog:           true,
    externalInterrupts: true,
    hardwareRng:        false,
    fpu:                false,
  },

  // ---- Build configuration ---------------------------------------------
  build: {
    platformio: 'megaatmega2560',
    arduino:    'arduino:avr:mega',
    extraFlags: ['-mmcu=atmega2560'],
    defines: {
      F_CPU:              '16000000UL',
      ARDUINO:            '10819',
      ARDUINO_AVR_MEGA2560: '1',
    },
  },
};

export default MyBoard;

// ---- Re-exports --------------------------------------------------------
export {
  D0, D1, /* ... all pin names ... */
  LED, TX, RX,
} from './pins';

export { I2C0, I2C1, SPI0, Serial, Serial1 } from './peripherals';
export { delay, millis, micros, delayMicroseconds, map, constrain } from './timing';
export { noInterrupts, interrupts, attachInterrupt, detachInterrupt } from './interrupts';
export { Board } from './board';
export type { IBoard } from './board';
```

---

## Step 2 — Pin stubs (`pins.ts`)

Each pin export is a stub object that satisfies its interface type at
design-time.  The transpiler never executes these stubs — it detects
the variable name in IR and replaces any method call with the correct
Arduino C++ built-in.

The constructor helpers (`createDigitalPin`, etc.) just bundle the pin
number so the transpiler can read it from the IR if needed.

```typescript
// code/board-<id>/pins.ts
import type { IDigitalPin, IPWMPin, IAnalogInput, IInterruptPin } from '../core';
import { pinNumber } from '../core';

function createDigitalPin(pin: number, gpio: number): IDigitalPin {
  return { number: pinNumber(pin), gpio: pinNumber(gpio) } as IDigitalPin;
}
function createPWMPin(pin: number, gpio: number): IPWMPin {
  return { number: pinNumber(pin), gpio: pinNumber(gpio) } as IPWMPin;
}
function createAnalogPin(pin: number, gpio: number): IAnalogInput {
  return { number: pinNumber(pin), gpio: pinNumber(gpio) } as IAnalogInput;
}
function createInterruptPin(pin: number, gpio: number): IDigitalPin & IInterruptPin {
  return { number: pinNumber(pin), gpio: pinNumber(gpio) } as IDigitalPin & IInterruptPin;
}

// Digital-only
export const D4:  IDigitalPin = createDigitalPin(4,  4);
export const D7:  IDigitalPin = createDigitalPin(7,  7);

// Interrupt-capable
export const D2:  IDigitalPin & IInterruptPin = createInterruptPin(2, 2);
export const D3:  IDigitalPin & IInterruptPin = createInterruptPin(3, 3);

// PWM
export const D5:  IPWMPin = createPWMPin(5,  5);
export const D6:  IPWMPin = createPWMPin(6,  6);

// Analog
export const A0:  IAnalogInput = createAnalogPin(14, 14);
export const A1:  IAnalogInput = createAnalogPin(15, 15);

// Aliases
export const LED = D13;   // change to whichever pin has the onboard LED
export const TX  = D1;
export const RX  = D0;
```

**Naming rules:**
- Digital pins: `D<number>` (e.g. `D0`–`D53`)
- Analog pins: `A<number>` (e.g. `A0`–`A15`)
- Standard aliases: `LED`, `TX`, `RX`, `SDA`, `SCL`, `MOSI`, `MISO`,
  `SCK`, `SS`
- Additional UART aliases: `TX1`/`RX1`, `TX2`/`RX2`, etc.

---

## Step 3 — Peripheral stubs (`peripherals.ts`)

Each peripheral is a stub with no runtime behaviour.  The transpiler maps
named method calls (e.g. `Serial.println`) to Arduino C++ built-ins.

```typescript
// code/board-<id>/peripherals.ts
import type { II2CBus, I2CConfig } from '../core/bus/i2c';
import { I2CSpeed } from '../core/bus/i2c';
import type { ISPIBus, SPIConfig } from '../core/bus/spi';
import { SPIMode, SPIBitOrder } from '../core/bus/spi';
import type { ISerialPort } from '../core/bus/uart';

export const I2C0: II2CBus = { /* ... same stub as Arduino Uno ... */ } as II2CBus;
export const SPI0: ISPIBus = { /* ... same stub as Arduino Uno ... */ } as ISPIBus;
export const Serial: ISerialPort = { /* ... same stub ... */ } as ISerialPort;

// If the board has multiple UARTs:
export const Serial1: ISerialPort = { /* ... same stub but for Serial1 ... */ } as ISerialPort;
```

The stub bodies are never executed so they can be identical across all
boards that share the same peripheral type (I2C, SPI, UART).  Only their
exported names matter to the transpiler.

**Peripheral export name conventions:**

| Export name | Transpiler maps to |
|-------------|-------------------|
| `Serial`    | `Serial`          |
| `Serial1`   | `Serial1`         |
| `I2C0`      | `Wire`            |
| `I2C1`      | `Wire1`           |
| `SPI0`      | `SPI`             |

---

## Step 4 — Timing helpers (`timing.ts`)

These are `declare function` stubs — no bodies needed.  The transpiler
maps each name to the corresponding Arduino C++ function automatically.

```typescript
// code/board-<id>/timing.ts
export declare function delay(ms: number): void;
export declare function millis(): number;
export declare function micros(): number;
export declare function delayMicroseconds(us: number): void;
export declare function map(value: number, fromLow: number, fromHigh: number, toLow: number, toHigh: number): number;
export declare function constrain(value: number, low: number, high: number): number;
```

This file can be copied verbatim from `board-arduino-uno/timing.ts` — it
is identical for every AVR/ARM Arduino-framework board.

---

## Step 5 — Interrupt helpers (`interrupts.ts`)

```typescript
// code/board-<id>/interrupts.ts
import type { InterruptHandler, InterruptMode } from '../core';

export declare function noInterrupts(): void;
export declare function interrupts(): void;
export declare function attachInterrupt(pin: number, handler: InterruptHandler, mode: InterruptMode): void;
export declare function detachInterrupt(pin: number): void;
```

Add any additional board-specific interrupt functions here if needed.
This file can also be copied verbatim for standard Arduino boards.

---

## Step 6 — Board namespace (`board.ts`)

`board.ts` exposes a single `Board` constant that aggregates all pins and
peripherals under one typed namespace.  This allows user code to write a
single import and access everything:

```typescript
import { Board } from './code/board-<id>/board';
Board.LED.high();
Board.Serial.println("Hello");
const flash = Board.definition.memory.flash; // folded to a literal at compile time
```

```typescript
// code/board-<id>/board.ts
import type {
  IDigitalPin, IPWMPin, IAnalogInput, IInterruptPin,
  II2CBus, ISPIBus, ISerialPort, BoardDefinition,
} from '../core';

import { D0, D1, /* ... */ A0, A1, /* ... */ LED, TX, RX } from './pins';
import { I2C0, SPI0, Serial } from './peripherals';
import { MyBoard } from './index';  // ← the manifest constant

export interface IBoard {
  readonly definition: BoardDefinition;

  // Pins
  readonly D0: IDigitalPin & IInterruptPin;
  readonly D1: IDigitalPin & IInterruptPin;
  readonly D2: IDigitalPin & IInterruptPin;
  // ... all pins ...
  readonly A0: IAnalogInput;
  // ... analog pins ...

  // Aliases
  readonly LED: IDigitalPin;
  readonly TX: IDigitalPin & IInterruptPin;
  readonly RX: IDigitalPin & IInterruptPin;

  // Peripherals
  readonly I2C0: II2CBus;
  readonly SPI0: ISPIBus;
  readonly Serial: ISerialPort;
}

export const Board: IBoard = {
  definition: MyBoard,
  D0, D1, /* ... all pin objects ... */
  A0, A1, /* ... */
  LED, TX, RX,
  I2C0, SPI0, Serial,
} as IBoard;

export default Board;
```

---

## Step 7 — Register pin names in the compiler

The compiler needs to know the *kind* of each pin symbol so it can emit
the correct Arduino C++ built-in.  Open `src/ir/typecode-symbols.ts` and
add your new pin names to the `STATIC_KINDS` map.

```typescript
// src/ir/typecode-symbols.ts
const STATIC_KINDS: Readonly<Record<string, TypecodeReceiverKind>> = {
  // ---- Existing Arduino Uno entries ... ----

  // ---- Your new board's additional pins --------------------------------

  // Digital-only pins new to this board
  D14: 'digital',
  D15: 'digital',
  // ...

  // New PWM pins
  D44: 'pwm',
  D45: 'pwm',
  D46: 'pwm',

  // New analog pins
  A6:  'analog-input',
  A7:  'analog-input',
  // ...

  // New named aliases
  TX1: 'digital',
  RX1: 'digital',
  TX2: 'digital',
  RX2: 'digital',

  // New peripheral instances
  I2C1:   'i2c',
  Serial1: 'serial',
};
```

**Receiver kind reference:**

| Kind           | Arduino C++ built-ins used                   | When to use                        |
|----------------|----------------------------------------------|------------------------------------|
| `digital`      | `digitalRead`, `digitalWrite`, `pinMode`     | No PWM, no analog, any I/O pin     |
| `pwm`          | `analogWrite`, `digitalRead`, `pinMode`      | Pin has hardware PWM output        |
| `analog-input` | `analogRead`, `pinMode`                      | Pin has an ADC channel             |
| `serial`       | `Serial.begin`, `Serial.println`, etc.       | Hardware UART port                 |
| `i2c`          | `Wire.begin`, `Wire.write`, etc.             | I2C/TWI bus                        |
| `spi`          | `SPI.begin`, `SPI.transfer`, etc.            | SPI bus                            |

Pins that are **both** PWM and interrupt-capable (e.g. D3 on Uno) should
be registered as `pwm` — the digital fallback methods (`digitalRead`,
`digitalWrite`, `pinMode`) are also generated for `pwm` pins.

After editing this file, rebuild the compiler:

```powershell
npx tsc -p tsconfig.json
```

---

## Step 8 — Verify constant folding

`Board.definition.*` accesses are folded to inline C++ literals at
transpile time.  The process:

1. `buildProgramIR` scans `import` statements for any path matching
   `/code/board-/`.
2. It resolves that import to `index.ts` in the board package directory.
3. `resolveBoardConstants` (`src/ir/board-resolver.ts`) parses the
   `index.ts` AST with `ts.createProgram`, finds the first exported
   `const` with an object-literal initializer typed as `BoardDefinition`,
   and walks its properties recursively.
4. The resulting flat `Map<dotPath, value>` is stored in
   `ProgramIR.boardConstants` and passed to the C++ emitter.
5. In the emitter, a `Board.definition.memory.flash` IR node renders as
   the literal `32768` rather than staying as a C++ identifier chain.

To manually verify that your board's constants are extracted correctly:

```powershell
node -e "
const path = require('path');
const { resolveBoardConstants } = require('./dist/ir/board-resolver');
const m = resolveBoardConstants(path.resolve('./code/board-<id>/index.ts'));
console.log('id:', m.get('id'));
console.log('mcu:', m.get('mcu'));
console.log('memory.flash:', m.get('memory.flash'));
console.log('clockSpeed:', m.get('clockSpeed'));
console.log('Total entries:', m.size);
"
```

Expected output lists every scalar field from your manifest (strings,
numbers, and booleans), keyed by their dot-path.

---

## Step 9 — Test the board

1.  **Write an example** importing from your new package:

    ```typescript
    // my-example.ts
    import { Board } from './code/board-<id>/board';

    Board.Serial.initialize({ baudRate: 115200 });
    Board.Serial.println("MCU: " + Board.definition.mcu);
    Board.LED.asOutput();

    while (true) {
      Board.LED.toggle();
      delay(500);
    }
    ```

2.  **Transpile it:**

    ```powershell
    node dist/cli.js transpile my-example.ts --target arduino --fqbn <arduino-fqbn>
    ```

    Check the generated `.ino` contains:
    - No `Board.definition.*` property chains — they should be literals
    - Correct Arduino built-ins for each pin call

3.  **Compile with arduino-cli:**

    ```powershell
    arduino-cli compile --fqbn <arduino-fqbn> --port <COM> --upload my-example\
    ```

4.  **Add vitest tests** in `tests/` alongside the existing test files if
    you want automated regression coverage.

---

## Reference: `BoardDefinition` shape

Full TypeScript interface (defined in `code/core/board/`):

```
BoardDefinition
├── id              string              unique lowercase kebab-case identifier
├── name            string              human-readable name
├── vendor          string              manufacturer name
├── description     string              one-line description
├── architecture    string              'avr' | 'arm' | 'xtensa' | 'riscv' | ...
├── mcu             string              exact MCU part number
├── clockSpeed      number              CPU frequency in Hz
├── memory
│   ├── flash       number              program storage in bytes
│   ├── sram        number              dynamic memory in bytes
│   └── eeprom      number              EEPROM in bytes (0 = absent)
├── pins
│   ├── all         PinDescriptor[]     one entry per physical pin (see below)
│   ├── digital     string[]            names of all digital I/O pins
│   ├── analog      string[]            names of all analog input pins
│   ├── pwm         string[]            names of all PWM-capable pins
│   ├── i2c         { [bus]: {sda, scl} }
│   ├── spi         { [bus]: {mosi, miso, sck, cs} }
│   ├── uart        { [bus]: {tx, rx} }
│   └── led         string              name of the onboard LED pin
├── peripherals
│   ├── i2c         I2CPeripheral[]
│   ├── spi         SPIPeripheral[]
│   ├── uart        UARTPeripheral[]
│   ├── adc         ADCPeripheral[]
│   └── pwm         PWMConfig
├── features
│   ├── multicore           boolean
│   ├── coreCount           number
│   ├── deepSleep           boolean
│   ├── watchdog            boolean
│   ├── externalInterrupts  boolean
│   ├── hardwareRng         boolean
│   └── fpu                 boolean
└── build
    ├── platformio  string              PlatformIO board ID
    ├── arduino     string              arduino-cli FQBN
    ├── extraFlags  string[]            compiler flags
    └── defines     Record<string, string>  preprocessor defines
```

### `PinDescriptor` shape

```
{
  number      number              Arduino pin number (used in pinMode / digitalRead)
  gpio        number              MCU GPIO number (may differ from Arduino number)
  name        string              primary pin name, matches key in digital/analog arrays
  aliases?    string[]            alternative names (e.g. 'LED', 'SDA', 'MOSI')
  capabilities PinCapabilityFlags  see table below
  functions?  PinFunction[]       peripheral role assignments
  onboardLed? boolean             true for the LED pin
}
```

---

## Reference: `PinCapabilityFlags`

```
{
  digitalInput:  boolean   // can read digital value
  digitalOutput: boolean   // can write digital value
  analogInput:   boolean   // has ADC channel
  analogOutput:  boolean   // has DAC channel (true-analog output)
  pwm:           boolean   // has hardware PWM
  interrupt:     boolean   // supports external interrupt
  pullUp:        boolean   // has internal pull-up resistor
  pullDown:      boolean   // has internal pull-down resistor
  touch:         boolean   // has capacitive touch capability
  openDrain:     boolean   // supports open-drain configuration
}
```

For AVR boards almost all pins share the digital I/O + pull-up baseline.
Use shorthand constants in your `index.ts` to avoid repetition:

```typescript
const DIGITAL         = { digitalInput: YES, digitalOutput: YES, analogInput: NO,
                          analogOutput: NO, pwm: NO, interrupt: NO,
                          pullUp: YES, pullDown: NO, touch: NO, openDrain: NO } as const;
const DIGITAL_INT     = { ...DIGITAL, interrupt: YES } as const;
const DIGITAL_PWM     = { ...DIGITAL, pwm: YES } as const;
const DIGITAL_PWM_INT = { ...DIGITAL, pwm: YES, interrupt: YES } as const;
const ANALOG_IN       = { ...DIGITAL, analogInput: YES } as const;
```
