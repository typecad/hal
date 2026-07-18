# @typecad/board-arduino-uno

Arduino Uno board definition package for TypeCAD.

## Overview

`@typecad/board-arduino-uno` provides a fully-typed TypeScript SDK for the Arduino Uno (ATmega328P). It exports pins, peripherals, timing utilities, and board metadata so TypeCAD can perform board-aware transpilation and catch hardware mistakes early.

## Quick start

Add or reference this board in `cuttlefish.config.ts`:

```ts
import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './src/main.ts',
  target: 'avr',
  mcu: '@typecad/mcu-atmega328p',
  board: '@typecad/board-arduino-uno',
  framework: '@typecad/framework-arduino',
  output: { framework: 'arduino', optimize: 'size' },
};

export default config;
```

Transpile and compile:

```bash
npx @typecad/cuttlefish src/main.ts --compile --upload --port COM3
```

## How to use

### Import styles

There are several import styles:

#### Virtual `@typecad/board` import (recommended)

```ts
import { D13, A0, LED, UART0, delay, millis, I2C0, SPI0, Board } from '@typecad/board';
```

The `@typecad/board` import is a virtual module that the TypeCAD transpiler resolves to whichever board package you configured in `cuttlefish.config.ts`. This is the recommended style.

#### Barrel import

```ts
import {
  D13, A0, LED, UART0, delay, millis,
  I2C0, SPI0, Board,
} from '@typecad/board-arduino-uno';
```

#### Board namespace

```ts
import { Board } from '@typecad/board-arduino-uno';

Board.D13.high();
Board.UART0.println('Hello');
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

The Arduino Uno pin package exposes peripheral pin mappings and capability information that TypeCAD uses to warn about unsafe pin usage. Key reserved pin groups include:

- `D0` / `D1` — UART0 RX/TX
- `A4` / `A5` — I2C0 SDA/SCL
- `D11` / `D12` / `D13` — SPI0 MOSI/MISO/SCK

### Example

```ts
import { LED, delay, HIGH } from '@typecad/board';

LED.output(HIGH);

while (true) {
  LED.toggle();
  delay(1000);
}
```

This package is intended to be used through the virtual `@typecad/board` import resolver in TypeCAD, but direct imports from `@typecad/board-arduino-uno` are also supported when you want explicit board package references.
