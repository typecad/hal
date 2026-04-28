# @typehal/board-arduino-uno

Arduino Uno board definition package for TypeHAL.

## Overview

`@typehal/board-arduino-uno` provides a fully-typed TypeScript SDK for the Arduino Uno (ATmega328P). It exports pins, peripherals, timing utilities, and board metadata so TypeHAL can perform board-aware transpilation and catch hardware mistakes early.

## Quick start

Add or reference this board in `typehal.config.ts`:

```ts
import type { TypehalConfig } from '@typehal/core';

const config: TypehalConfig = {
  target: 'avr',
  board: '@typehal/board-arduino-uno',
  fqbn: 'arduino:avr:uno',
  output: { framework: 'arduino', optimize: 'size' },
};

export default config;
```

Transpile and compile:

```bash
npx typehal src/main.ts --compile --upload --port COM3
```

## How to use

### Import styles

There are several import styles:

#### Individual imports

```ts
import { D13, A0 } from '@typehal/board-arduino-uno/pins';
import { UART0 } from '@typehal/board-arduino-uno/peripherals';
import { delay, millis } from '@typehal/board-arduino-uno/timing';
```

#### Board namespace

```ts
import { Board } from '@typehal/board-arduino-uno/board';

Board.D13.high();
Board.UART0.println('Hello');
```

#### Barrel import

```ts
import {
  D13, A0, LED, UART0, delay, millis,
  I2C0, SPI0, Board,
} from '@typehal/board-arduino-uno';
```

#### Virtual `@typehal` import (recommended)

```ts
import { D13, A0, LED, UART0, delay, millis, I2C0, SPI0, Board } from '@typehal';
```

### Pin and peripheral exports

The package exports full Uno pin definitions plus convenience aliases:

- `D0`..`D13`
- `A0`..`A5`
- `LED`, `SDA`, `SCL`, `MOSI`, `MISO`, `SCK`, `SS`, `TX`, `RX`
- `I2C0`, `SPI0`, `UART0`
- timing utilities: `delay`, `millis`, `micros`, `delayMicroseconds`, `map`, `constrain`
- numeric helpers: `abs`, `min`, `max`, `clamp`, `inRange`, `toPercent`, `toByte`, `Num`
- pulse helpers: `pulseIn`, `pulseInLong`, `Pulse`
- shift utilities: `shiftIn`, `shiftOut`, `Shift`, `ShiftBitOrder`
- random utilities: `randomSeed`, `random`, `Random`
- analog helpers: `AnalogReference`, `analogReference`
- interrupt helpers: `noInterrupts`, `interrupts`, `attachInterrupt`, `detachInterrupt`

### Pin safety

The Arduino Uno pin package exposes peripheral pin mappings and capability information that TypeHAL uses to warn about unsafe pin usage. Key reserved pin groups include:

- `D0` / `D1` — UART0 RX/TX
- `A4` / `A5` — I2C0 SDA/SCL
- `D11` / `D12` / `D13` — SPI0 MOSI/MISO/SCK

### Example

```ts
import { LED, delay, HIGH } from '@typehal';

LED.output(HIGH);

while (true) {
  LED.toggle();
  delay(1000);
}
```

This package is intended to be used through the virtual `@typehal` import resolver in TypeHAL, but direct imports from `@typehal/board-arduino-uno` are also supported when you want explicit board package references.
